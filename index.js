const request = require('request')
const http = require('http')
const https = require('https')
const path = require('path')
const fs = require('fs')
const url = require('url')
const qs = require('querystring')

const CONFIG = {
  site: '',
  // test
  username: '',
  password: '',
  recordList: `http://cms.${this.site}.com.cn:8080/${this.site}/Enq`
}

const isLeagelSite = site => ['pconline', 'pcauto', 'pclady', 'pcbaby', 'pchouse'].indexOf(CONFIG.site) !== -1

exports.verifyUser = function (opts) {
  return new Promise(async function (resolve, reject) {
    Object.assign(CONFIG, opts)

    if (!isLeagelSite(CONFIG.site)) {
      return reject(new Error('Illegal site!'))
    }

    const postContent = qs.stringify({
      app: 'upload_' + CONFIG.site,
      return: `http://cms.${CONFIG.site}.com.cn:8080/${CONFIG.site}/Security?dispatch =login`,
      // "return": 'http://cms.pconline.com.cn:8080/pconline/login.jsp',
      username: CONFIG.username,
      password: CONFIG.password
    })

    const headers = {
      Accept: 'text/html,application/xhtml+xml,application/xmlq=0.9,image/webp,*/*q=0.8',
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: `http://cms.${CONFIG.site}.com.cn:8080`,
      Referer: `http://cms.${CONFIG.site}.com.cn:8080/${CONFIG.site}/Security?dispatch=login`,
      // 'Referer':'http://cms.pconline.com.cn:8080/pconline/login.jsp',
      'Upgrade-Insecure-Requests': '1',
      'User-Agent': 'Mozilla/5.0 (Macintosh Intel Mac OS X 10_11_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.104 Safari/537.36',
      'Content-Length': postContent.length
    }

    const options = {
      hostname: 'auth.pconline.com.cn',
      port: 443,
      path: '/security-server/auth.do',
      method: 'POST',
      headers: headers,
      rejectUnauthorized: false,
      requestCert: true
    }

    const form = `http://cms.${CONFIG.site}.com.cn:8080/${CONFIG.site}/Security?dispatch=login`

    const getSession = function (resolve, reject) {
      return new Promise(function (resolve, reject) {
        const req = http.get(form, function (res) {
          var session = res.headers['set-cookie'][0]
          session = session.split(';')[0]
          if (session) {
            resolve(session)
          } else {
            reject(new Error('no session'))
          }
        })
        req.end()
      })
    }
    console.log('验证用户...')

    try {
      const session = await getSession()
      options.headers.cookie = session
      const req = https
        .request(options, function (res) {
          if (!res.headers.location) {
            reject(new Error('账号不正常，请确认账号能否正常使用！'))
            return false
          }

          var _url = url.parse(res.headers.location)
          var tmp = url.parse(_url).query
          var _res = qs.parse(tmp)
          if (parseInt(_res.st) === -1) {
            reject(new Error('用户密码错误，请检查配置文件！'))
          } else {
            console.log('验证成功')
            resolve(session)
          }
        })
        .on('error', function (err) {
          reject(err)
        })
      req.write(postContent)
      req.end()
    } catch (err) {
      return reject(err)
    }
  })
}

exports.upload = function (file, opts, session) {
  return new Promise(async function (resolve, reject) {
    Object.assign(CONFIG, opts)

    let {
      targetPath
    } = opts

    if (!isLeagelSite(CONFIG.site)) {
      return reject(new Error('Illegal site!'))
    }

    if (!targetPath) {
      return reject(new Error('Illegal path!'))
    }

    targetPath = targetPath.replace(/([^/]$)/, '$1/').replace(/(^[^/])/, '/$1')

    // {zip,jpg,png,gif,js,css,html,mp3,mp4}
    const setFileObj = function (filePath) {
      return {
        value: fs.createReadStream(filePath),
        options: {
          filename: path.basename(filePath)
        }
      }
    }

    let _files = []
    if (Array.isArray(file)) {
      file.forEach(function (item) {
        _files.push(setFileObj(item.path))
      })
    } else {
      _files = setFileObj(file)
    }

    // from request payload
    const formData = {
      dispatch: 'upload',
      colId: '/',
      ulUser: CONFIG.username, // back end record
      siteId: '2',
      colIdNormal: '/',
      toDir: targetPath,
      ulfile: _files
    }

    function upload () {
      return new Promise(function (resolve, reject) {
        // docs: https://www.npmjs.com/package/request#multipartform-data-multipart-form-uploads
        request.post({
          // target server ==  nginx || resin
          url: `http://cms.${CONFIG.site}.com.cn:8080/${CONFIG.site}/Upload`,
          // headers:pconlineHeaders,
          headers: {
            cookie: session // session from request.post is invalid when site is pconline
          },
          formData: formData
        },
        function (err, res, body) {
          if (err) {
            return reject(err)
          }
          resolve(body)
        })
      })
    }

    console.log('开始上传...')
    // docs: https://www.npmjs.com/package/request#multipartform-data-multipart-form-uploads
    try {
      const body = await upload()
      const reg = /<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g
      const _arr = body.match(reg)
      _arr.forEach(function (item) {
        const s = item.match(/>(.*)</)
        console.log('已上传: ', s[1])
      })

      console.log('已上传全部文件！')

      return new Promise(function (resolve, reject) {
        resolve()
      })
    } catch (err) {
      reject(new Error(err))
    }
  })
}
