const fs = require('fs')
const url = require('url')
const querystring = require('querystring')
const got = require('got')
const FormData = require('form-data')

const CONFIG = {
  site: '',
  username: '',
  password: '',
  recordList: `http://cms.${this.site}.com.cn:8080/${this.site}/Enq`,
  uploadBaseUrl: ''
}

const isLeagelSite = site => ['pconline', 'pcauto', 'pclady', 'pcbaby', 'pchouse'].indexOf(site) !== -1

let uploadClient = got.extend({})

let session

exports.init = function ({ site }) {
  if (!isLeagelSite(site)) {
    throw new Error('Illegal site!')
  } else {
    Object.assign(CONFIG, {
      site,
      uploadBaseUrl: `http://cms.${site}.com.cn:8080/${site}`
    })

    uploadClient = got.extend({
      baseUrl: CONFIG.uploadBaseUrl
    })
  }
}

const verifyUser = async function (user) {
  if (!isLeagelSite(CONFIG.site)) {
    throw new Error('Unable to get site, please use init first!')
  }

  Object.assign(CONFIG, user)

  const postContent = {
    app: 'upload_' + CONFIG.site,
    return: `${CONFIG.uploadBaseUrl}/Security?dispatch=login`,
    username: CONFIG.username,
    password: CONFIG.password
  }

  const getSession = async location => {
    let sessionRes
    try {
      sessionRes = await got.post(location)
    } catch (err) {
      if (err.statusCode === 302) {
        sessionRes = err
      } else {
        throw err
      }
    }

    return sessionRes.headers['set-cookie'][0].match(/JSESSIONID=\S+;/g)[0].replace(';', '')
  }

  console.log('验证用户...')

  const { headers: { location }, statusCode } = await got.post('https://auth.pconline.com.cn/security-server/auth.do', {
    form: true,
    body: postContent,
    throwHttpErrors: false
  })

  if (!location) {
    throw new Error(`账号不正常，请确认账号能否正常使用！Response code ${statusCode}`)
  }

  const {
    query
  } = url.parse(location)
  const {
    st
  } = querystring.parse(query)
  if (parseInt(st) === -1) {
    throw new Error('用户密码错误，请检查配置文件！')
  } else {
    session = await getSession(location)
    uploadClient = uploadClient.extend({
      headers: {
        cookie: session
      }
    })
    console.log('验证成功')
    return session
  }
}

exports.upload = async function (file, opts, _session = session) {
  if (!isLeagelSite(CONFIG.site)) {
    throw new Error('Unable to get site, please use init first!')
  }

  Object.assign(CONFIG, opts)

  let {
    targetPath
  } = opts

  if (!_session) {
    await verifyUser(opts.user)
  }

  if (!targetPath) {
    throw new Error('Illegal path!')
  }

  targetPath = targetPath.replace(/([^/]$)/, '$1/').replace(/(^[^/])/, '/$1')

  const formData = {
    dispatch: 'upload',
    colId: '/',
    ulUser: CONFIG.username, // back end record
    siteId: '2',
    colIdNormal: '/',
    toDir: targetPath
  }

  const form = new FormData()

  Object.keys(formData).forEach(k => {
    form.append(k, formData[k])
  })

  // append files
  Array.prototype.concat(file).forEach(f => form.append('ulfile', fs.createReadStream(f)))

  async function upload () {
    let res
    try {
      res = await uploadClient.post('/Upload', {
        body: form
      })
    } catch (err) {
      if (err.statusCode === 302) {
        res = err
      } else {
        throw err
      }
    }
    return res.body
  }

  console.log('开始上传...')

  try {
    const body = await upload()
    const reg = /<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g
    const uploadedFiles = body.match(reg)
    uploadedFiles.forEach(function (item) {
      const s = item.match(/>(.*)</)
      console.log('已上传:', s[1])
    })

    console.log('已上传上述文件！')

    return true
  } catch (err) {
    throw err
  }
}

exports.verifyUser = verifyUser
