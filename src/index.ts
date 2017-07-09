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
  // await mock(i)
  for ( ; ; ) {
    const message = await comsumer.brpop(['JUDGER'], 0)
    const submissionId = message[1]
    console.log(submissionId)
    getSubmissionById(submissionId).then(async submission => {
      if (submission) {
        const judger = new Judger(submission)
        const result = await judger.process()
        console.log(result)
        await producer.lpush('JUDGER_FINISH', JSON.stringify({
          ...JSON.parse(result.replace(/'/g, '"')),
          submissionId
        }))
      }
    }).catch(async e => {
      console.log('编译出错', e)
      await producer.lpush('JUDGER_FINISH', JSON.stringify({
        submissionId,
        exit_code: -1,
        memory: -1,
        result: 6,  // 编译错误
        cpu_time: -1,
        signal: -1,
        real_time: -1,
        error: -1
      }))
    })

  }
}).catch((e: Error) => console.log(e))

const mock = async (i: number) => {
  await comsumer.lpush('JUDGER', i)
}

const getSubmissionById = (submissionId: number): Promise<ISubmission> => {
  return new Promise((resolve: (res: ISubmission) => void, reject: (err: Error) => void) => {
    db.query(`SELECT * FROM submission INNER JOIN problem ON submission.problemId = problem.id WHERE submission.id = ${submissionId}`,
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
