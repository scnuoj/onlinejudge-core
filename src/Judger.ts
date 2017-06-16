/**
 * 判题 Judger
 */
import * as buffer from 'buffer'
import * as Docker from 'dockerode'
import * as Stream from 'stream'

export interface ILimit {
  maxCpuTime: number
  maxRealTime: number
  maxMemory: number
  maxProcessNumber: number
  maxOutputSize: number
}

export interface ISubmission extends ILimit {
  code: string
  inputData: string
}

const docker = new Docker({
  socketPath: '/var/run/docker.sock'
})

export class Judger {
  private docker: Docker
  private container: Docker.Container

  private readonly sourceCodePath: string = '/root/main.cc'
  private readonly inputDataPath: string = '/root/main.in'
  private readonly outputDataPath: string = '/root/main.out'
  private readonly errorPath: string = '/root/error.txt'
  private readonly logPath: string = '/root/log.txt'
  private readonly script: string = '/root/main.py'
  private stream: Stream
  private submission: ISubmission

  constructor (submission: ISubmission) {
    this.docker = docker
    this.submission = submission
  }

  public async process () : Promise<string> {
    let result: string
    try {
      result = await this.runCode()
    } catch (e) {
      console.log(e)
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
      StdinOnce: false
    })
    await this.container.start()
    const commands: string[] = ['bash', '-c',
      [this.writeCode(this.submission.code),
      this.writeInputData(this.submission.inputData),
      this.judging(this.submission)].join(' && ')
    ]
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
        stream.on('data', (chunk: Buffer) => { result = chunk.toString('utf8', 8) })
        stream.on('end', () => resolve(result))
        stream.on('close', () => resolve(result))
      })
    })

    return result
  }

  private async destroyContainer (): Promise<void> {
    await this.container.stop()
    console.log('Container stop success!')
    await this.container.remove()
    console.log('Container destroy success!')
  }

  private writeCode (sourceCode: string): string {
    return `echo "${sourceCode}" > ${this.sourceCodePath}`
  }

  private writeInputData (inputData: string): string {
    return `echo "${inputData}" > ${this.inputDataPath}`
  }

  private judging (limit: ILimit): string {
    return `echo "${this.wrapData(limit)}" > ${this.script} && /usr/bin/python3 ${this.script}`
  }

  private wrapData (limit: ILimit): string {
    return `import _judger\nprint(_judger.run(
      max_cpu_time=${limit.maxCpuTime},
      max_real_time=${limit.maxRealTime},
      max_memory=${limit.maxMemory},
      max_process_number=${limit.maxProcessNumber},
      max_output_size=${limit.maxOutputSize},
      max_stack=33554432,
      exe_path='${this.sourceCodePath}',
      input_path='${this.inputDataPath}',
      output_path='${this.outputDataPath}',
      error_path='${this.errorPath}',
      args=[],
      env=[],
      log_path='${this.logPath}',
      seccomp_rule_name='c_cpp',
      uid=0,
      gid=0))`.replace(/\s\s+/g, '')
  }

}
