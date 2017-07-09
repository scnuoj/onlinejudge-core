/**
 * 判题 Judger
 */
import * as buffer from 'buffer'
import { exec } from 'child_process'
import * as Docker from 'dockerode'
import * as fs from 'fs'
import * as path from 'path'
import * as Stream from 'stream'
import * as util from 'util'

const writeFileAsync = util.promisify(fs.writeFile)
const readFileAsync = util.promisify(fs.readFile)
const mkdirAsync = util.promisify(fs.mkdir)
const repository = path.resolve(__dirname, '..', 'repository')

export interface ILimit {
  maxCpuTime: number
  maxRealTime: number
  maxMemory: number
  maxProcessNumber: number
  maxOutputSize: number
}

export interface ISubmission extends ILimit {
  id: number
  code: string
  inputData: string
  outputData: string
}

const docker = new Docker({
  socketPath: '/var/run/docker.sock'
})

/**
 * TODO 待优化
 * 1. 重用 py 和输入文件, 确保生成一次
 * 2. 容器内的判题不要对外部产生任何副作用(不要生成输出文件, 日志文件到外部来)
 * 3. 优化 py 脚本, 在容器内对比判题输出和期望输出是否一致
 * 4. 增强容错性
 */
export class Judger {
  private docker: Docker
  private container: Docker.Container
  private readonly timestamp: string
  private readonly outerWorkDir: string
  private readonly innerWorkDir: string
  private readonly execFilePath: string
  private readonly execFileInputPath: string
  private readonly innerOutputDataPath: string
  private readonly outerOutputDataPath: string
  private readonly errorPath: string
  private readonly logPath: string
  private readonly script: string = '/root/main.py' // 存 docker 即可
  private stream: Stream
  private submission: ISubmission

  constructor (submission: ISubmission) {
    this.docker = docker
    this.submission = submission
    this.timestamp = Date.now().toString()
    this.outerWorkDir = path.resolve(__dirname, '..', 'repository', this.timestamp)
    this.innerWorkDir = path.join('/root', this.timestamp)
    this.execFilePath = path.join(this.innerWorkDir, this.submission.id.toString())
    this.execFileInputPath = path.join(this.innerWorkDir, `${this.submission.id}.in`)
    this.outerOutputDataPath = path.join(this.outerWorkDir, 'main.out')
    this.innerOutputDataPath = path.join(this.innerWorkDir, 'main.out')
    this.errorPath = path.join(this.innerWorkDir, 'error.txt')
    this.logPath = path.join(this.innerWorkDir, 'log.txt')
  }

  public async process () : Promise<string> {
    let result: string
    try {
      await mkdirAsync(this.outerWorkDir)
      result = await this.runCode()
      if (JSON.parse(result.replace(/'/g, '"')).result === 0) {
        await this.checkOutput()
      }
    } catch (e) {
      throw e
    } finally {
      this.destroyContainer()
    }

    return result
  }

  private async runCode (): Promise<string> {
    let result: string
    this.container = await this.docker.createContainer({
      Image: 'onlinejudge',
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      Cmd: ['/bin/bash'],
      OpenStdin: true,
      StdinOnce: false,
      HostConfig: {
        Binds: [`${this.outerWorkDir}:${this.innerWorkDir}`]
      }
    })
    await Promise.all([
      this.container.start(),
      this.writeCode(),
      this.writeInputData()
    ])
    await this.compile()
    const commands: string[] = ['bash', '-c', this.judging(this.submission)]
    const exec: Docker.Exec = await this.container.exec({
      Cmd: commands,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true
    })
    await new Promise((resolve: (data: string) => void, reject: (err: Error) => void): void => {
      exec.start({
        stdin: true,
        hijack: true
      }, (err: Error, stream: NodeJS.ReadableStream) => {
        if (err) {
          reject(err)
        }
        stream.on('data', (chunk: Buffer) => { result = chunk.toString('utf8', 8); console.log(result) })
        stream.on('end', () => resolve(result))
        stream.on('close', () => resolve(result))
      })
    })

    return result
  }

  private async checkOutput (): Promise<void> {
    const output = (await readFileAsync(this.outerOutputDataPath, 'utf8')).trim().split('\n')
    const correctOutput = this.submission.outputData.trim().split('\n')
    console.log(output)
    if (output.length !== correctOutput.length) {
      throw new Error('Output rows count no match!')
    }
    for (let i = 0; i < output.length; i = i + 1 ) {
      if (output[i] !== correctOutput[i]) {
        throw new Error(`Result ${output[i]} no match ${correctOutput[i]}`)
      }
    }
  }

  /**
   * 销毁容器
   */
  private async destroyContainer (): Promise<void> {
    await this.container.stop()
    console.log('Container stop success!')
    await this.container.remove()
    console.log('Container destroy success!')
  }

  /**
   * 将用户代码写入文件
   */
  private async writeCode (): Promise<void> {
    await writeFileAsync(path.resolve(this.outerWorkDir, `${this.submission.id}.cc`), this.submission.code)
  }

  /**
   * 将用户代码的测试输入写入到文件
   */
  private async writeInputData (): Promise<void> {
    await writeFileAsync(path.resolve(this.outerWorkDir, `${this.submission.id}.in`), this.submission.inputData)
  }

  /**
   * 本机编译用户的代码
   */
  private compile (): Promise<{}> {
    return new Promise((resolve, reject) => {
      exec(`/usr/bin/g++ ${path.resolve(this.outerWorkDir, `${this.submission.id}.cc`)} \
            -o ${path.resolve(this.outerWorkDir, `${this.submission.id}`)} \
            -w -lm --static -DONLINE_JUDGE`, (err, stdout, stderr) => {
        if (err || stderr) {
          reject(err || stderr)
        }
        resolve()
      })
    })
  }

  /**
   * 返回一段运行脚本
   * @param limit 资源限制
   */
  private judging (limit: ILimit): string {
    return `echo "${this.wrapData(limit)}" > ${this.script} &&
            /usr/bin/python3 ${this.script} &&
            cat ${this.innerOutputDataPath}`
  }

  private wrapData (limit: ILimit): string {
    console.log(`import _judger\nprint(_judger.run(
      max_cpu_time=${limit.maxCpuTime},
      max_real_time=${limit.maxRealTime},
      max_memory=${limit.maxMemory},
      max_process_number=${limit.maxProcessNumber},
      max_output_size=${limit.maxOutputSize},
      max_stack=33554432,
      exe_path='${this.execFilePath}',
      input_path='${this.execFileInputPath}',
      output_path='${this.innerOutputDataPath}',
      error_path='${this.errorPath}',
      args=[],
      env=[],
      log_path='${this.logPath}',
      seccomp_rule_name='c_cpp',
      uid=0,
      gid=0))`.replace(/\s\s+/g, ''))

    return `import _judger\nprint(_judger.run(
      max_cpu_time=${limit.maxCpuTime},
      max_real_time=${limit.maxRealTime},
      max_memory=${limit.maxMemory},
      max_process_number=${limit.maxProcessNumber},
      max_output_size=${limit.maxOutputSize},
      max_stack=33554432,
      exe_path='${this.execFilePath}',
      input_path='${this.execFileInputPath}',
      output_path='${this.innerOutputDataPath}',
      error_path='${this.errorPath}',
      args=[],
      env=[],
      log_path='${this.logPath}',
      seccomp_rule_name='c_cpp',
      uid=0,
      gid=0))`.replace(/\s\s+/g, '')
  }

}
