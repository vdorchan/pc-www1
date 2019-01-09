const fs = require('fs')
const url = require('url')
const querystring = require('querystring')
const got = require('got')
const FormData = require('form-data')
const iconv = require('iconv-lite')

class Www1 {
  /**
   * @constructor
   * @param {Object} options
   * @param {string} options.username
   * @param {string} options.password
   * @param {string} options.site
   * @param {string} [options.debug]
   */
  constructor (options) {
    Object.assign(this, options)

    if (!this.username) throw new Error('用户名不能为空')
    if (!this.password) throw new Error('密码不能为空')
    if (!this.isLegalSite(this.site)) {
      throw new Error(`site 参数不合法，site 必须是 ${Www1.siteList.join(',')} 其中一个！`)
    }

    this.uploadBaseUrl = `http://cms.${this.site}.com.cn:8080/${this.site}`
  }

  async checkLogin () {
    if (!this.uploadClient) {
      if (this.username) {
        await this.login()
      } else {
        throw new Error('用户未登录，请先登录！')
      }
    }
  }

  static login (options) {
    return new Www1(options).login()
  }
  static upload (filePath, targetPath, options) {
    return new Www1(options).upload(filePath, targetPath)
  }

  static queryLog (queryOptions, options) {
    return new Www1(options).queryLog(queryOptions)
  }

  /**
   * verify the user
   */
  async login () {
    const postContent = {
      app: 'upload_' + this.site,
      return: `${this.uploadBaseUrl}/Security?dispatch=login`,
      username: this.username,
      password: this.password
    }

    this.log(`${this.username} 正在登录中...`)

    const { headers: { location }, statusCode } = await got.post('https://auth.pconline.com.cn/security-server/auth.do', {
      form: true,
      body: postContent,
      throwHttpErrors: false
    })

    if (!location) {
      this.log('登录失败')
      throw new Error(`账号不正常，请确认账号能否正常使用！Response code ${statusCode}`)
    }

    const { query } = url.parse(location)
    const { st } = querystring.parse(query)

    if (parseInt(st) === -1) {
      this.log('登录失败')
      throw new Error('用户密码错误，请检查配置文件！')
    } else {
      const session = await this._getSession(location)
      this.uploadClient = got.extend({
        baseUrl: this.uploadBaseUrl,
        headers: {
          cookie: session
        }
      })
      this.log('登录成功')
    }
  }

  /**
   *  upload files
   * @param {string|string[]} filePath
   * @param {string} targetPath
   * @return {Promise<string>} uploaded files
   */
  async upload (filePath, targetPath) {
    if (!filePath) {
      throw new Error('上传文件不能为空！')
    }

    await this.checkLogin()

    if (!targetPath) {
      throw new Error('上传路径不能为空!')
    }

    targetPath = targetPath.replace(/^[/]?(\S+[^/])[/]?$/g, '/$1/')

    const formData = {
      dispatch: 'upload',
      colId: '/',
      ulUser: this.username, // back end record
      siteId: '2',
      colIdNormal: '/',
      toDir: targetPath
    }

    const form = new FormData()

    Object.keys(formData).forEach(k => {
      form.append(k, formData[k])
    })

    // append files
    Array.prototype.concat(filePath).forEach(f => form.append('ulfile', fs.createReadStream(f)))

    this.log('开始上传...')

    let uploadedFiles = []

    const body = await this._uploadFiles(form)

    try {
      const reg = /<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g
      uploadedFiles = body.match(reg).map(item => {
        const s = item.match(/>(.*)</)
        this.log('已上传:', s[1])
        return s[1]
      })

      this.log('已上传上述文件！')
    } catch (error) {
    }

    return uploadedFiles
  }

  /**
   *
   * @param {Object} [options={}]
   * @param {string} [form=today] ex. 2018-12-25
   * @param {string} [to=from] ex. 2018-12-25
   * @param {string} pageNo ex. 2018-12-25
   * @return {Promise<Array>}
   */
  async queryLog ({ from = new Date().toISOString().replace(/T.+/g, ''), to = from, pageNo = 1 } = {}) {
    await this.checkLogin()

    this.log(`正在查询 ${from} 到 ${to} 的上传日志...`)

    const formData = {
      dispatch: 'searchULLog',
      ttPage: 0,
      fileName: '',
      status: '',
      siteId: '',
      col: '',
      dFrom: from,
      dTo: to,
      pageNo
    }

    const res = await this.uploadClient.post('/Enq', {
      form: true,
      body: formData,
      encoding: null
    })

    const html = iconv.decode(res.body, 'gbk').replace(/[\n\r\t]/g, '').replace(/.+divGrid/g, '').replace(/<\/table>.+/g, '')

    var trs = this._getTagContent(html, 'tr')

    let uploadedList = []
    let output = ''
    trs.forEach(tr => {
      const tds = this._getTagContent(tr, 'td')
      if (tds.length && tds[0]) {
        const username = tds[0]
        const size = tds[2]
        const lastModifyTime = tds[3]
        const uploadTime = tds[4]
        const status = tds[5]
        let url = ''
        try {
          url = this._getTagContent(tds[1], 'a')[0]
        } catch (error) {
        }

        uploadedList.push({ username, url, size, lastModifyTime, uploadTime, status })

        output += `${username} ${uploadTime} ${status} ${url}\n`
      }
    })

    this.log('查询结束')

    this.log(output || '当前查询条件下无结果')

    return uploadedList
  }

  /**
   *
   * @param {FormData} form
   */
  async _uploadFiles (form) {
    let res
    try {
      res = await this.uploadClient.post('/Upload', {
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

  log (...args) {
    this.debug && console.log(...args)
  }

  /**
   *
   * @param {string} location
   */
  async _getSession (location) {
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

  /**
   * verify site is legal
   * @param {string} site
   * @return {boolean}
   */
  isLegalSite (site) {
    return Www1.siteList.includes(site)
  }

  _getTagContent (html, tag) {
    const reg = new RegExp(`<${tag}[^>]*>(.+?)</${tag}>`, 'g')
    let tags = html.match(reg) || []

    if (tags.length) {
      tags = tags.map(t => t.replace(reg, '$1'))
    }

    return tags
  }
}

Www1.siteList = ['pconline', 'pcauto', 'pclady', 'pcbaby', 'pchouse']

module.exports = Www1
