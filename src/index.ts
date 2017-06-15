import * as Docker from 'dockerode'
import * as Redis from 'ioredis'
import * as Mysql from 'mysql'
import config from './config'
import Judger from './judger'

const RedisConfig = config.redis
const MysqlConfig = config.mysql

const comsumer = new Redis(RedisConfig.port, RedisConfig.host, {
  password: RedisConfig.password,
  db: RedisConfig.db
})

const producer = new Redis(RedisConfig.port, RedisConfig.host, {
  password: RedisConfig.password,
  db: RedisConfig.db
})

const judger = new Judger()

const db = Mysql.createConnection(MysqlConfig)

new Promise((resolve, reject) => {
  db.connect(e => e ? reject(e) : resolve())
}).then(async () => {
  await mock()
  while (true) {
    const message = await comsumer.brpop(['JUDGER'], 0)
    const { submissionId } = JSON.parse(message[1]).payload
    const submission = await getSubmissionById(submissionId)
    judger.process(submission)
  }
}).catch(e => console.log(e))

const mock = async () => {
  await comsumer.lpush('JUDGER', JSON.stringify({
    event: 'JUDGE_SUBMISSION',
    payload: {
      submissionId: 1
    }
  }))
}

const getSubmissionById = (submissionId: number) => new Promise((resolve, reject) => {
  db.query(`SELECT * FROM Submission INNER JOIN Problem ON Submission.problemId = Problem.id WHERE Submission.id = ${submissionId}`, (err, results, fields) => {
    if (err) {
      reject(err)
    } else {
      resolve(results[0])
    }
  })
})
