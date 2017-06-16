/**
 * index.ts
 */
import * as Docker from 'dockerode'
import * as Redis from 'ioredis'
import * as Mysql from 'mysql'
import { config } from 'src/config'
import { ISubmission, Judger } from 'src/Judger'

const redisConfig = config.redis
const mysqlConfig = config.mysql

const comsumer = new Redis(redisConfig.port, redisConfig.host, {
  password: redisConfig.password,
  db: redisConfig.db
})

const producer = new Redis(redisConfig.port, redisConfig.host, {
  password: redisConfig.password,
  db: redisConfig.db
})

const db = Mysql.createConnection(mysqlConfig)

new Promise((resolve: () => void, reject: (e: Error) => void) => {
  db.connect((e: Error) => e ? reject(e) : resolve())
}).then(async () => {
  // await mock()
  for ( ; ; ) {
    const message = await comsumer.brpop(['JUDGER'], 0)
    const submissionId = message[1]
    const submission = await getSubmissionById(submissionId)
    const judger = new Judger(submission)
    const result = await judger.process()
    await producer.lpush('JUDGER_FINISH', JSON.stringify({
      ...JSON.parse(result.replace(/'/g, '"')),
      submissionId
    }))
  }
}).catch((e: Error) => console.log(e))

const mock = async () => {
  await comsumer.lpush('JUDGER', 1)
}

const getSubmissionById = (submissionId: number): Promise<ISubmission> => {
  return new Promise((resolve: (res: ISubmission) => void, reject: (err: Error) => void) => {
    db.query(`SELECT * FROM Submission INNER JOIN Problem ON Submission.problemId = Problem.id WHERE Submission.id = ${submissionId}`,
      (err: Error, results: ISubmission[]) => {
        if (err) {
          reject(err)
        } else {
          resolve(results[0])
        }
      }
    )
  })
}
