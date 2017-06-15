import * as buffer from 'buffer'
import * as Docker from 'dockerode'
import * as Stream from 'stream'

interface Limit {
  maxCpuTime: number,
  maxRealTime: number,
  maxMemory: number,
  maxProcessNumber: number,
  maxOutputSize: number
}

export default class Judger {
  private docker: Docker
  private container: Docker.Container

  private readonly sourceCodePath = '/root/main.cc'
  private readonly inputDataPath = '/root/main.in'
  private readonly outputDataPath = '/root/main.out'
  private readonly errorPath = '/root/error.txt'
  private readonly logPath = '/root/log.txt'
  private readonly script = '/root/main.py'
  private stream: Stream

  private data: string

  constructor () {
    this.docker = new Docker({
      socketPath: '/var/run/docker.sock'
    })
  }

  public async process (submission) {
    try {
      await this.runCode(submission)
    } catch (e) {
      console.log(e)
    } finally {
      this.destroyContainer()
    }
  }

  private async runCode (submission) {
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
    const commands = ['bash', '-c',
      [this.writeCode(submission.code),
      this.writeInputData(submission.inputData),
      this.judging(submission as Limit)].join(' && ')
    ]
    const exec = await this.container.exec({
      Cmd: commands,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true
    }) as Docker.Exec
    await new Promise((resolve, reject) => exec.start({
      stdin: true,
      hijack: true
    }, (err, stream: NodeJS.ReadableStream) => {
      if (err) {
        reject(err)
      }
      stream.on('data', chunk => { this.data = (chunk as Buffer).toString('utf8', 8) })
      stream.on('end', () => resolve(this.data))
      stream.on('close', () => resolve(this.data))
    }))
    console.log(this.data)
  }

  private async destroyContainer () {
    await this.container.stop()
    await this.container.remove()
    console.log('Container destroy success!')
  }

  private writeCode (sourceCode: string) {
    return `echo "${sourceCode}" > ${this.sourceCodePath}`
  }

  private writeInputData (inputData: string) {
    return `echo "${inputData}" > ${this.inputDataPath}`
  }

  private judging (limit: Limit) {
    return `echo "${this.wrapData(limit)}" > ${this.script} && /usr/bin/python3 ${this.script}`
  }

  private wrapData (limit: Limit) {
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
