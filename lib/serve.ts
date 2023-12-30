import * as path from 'path';
import { ChildProcess, spawn } from 'child_process';

const usage = (error?: string) => {
  console.error('[Usage]');
  console.error(`node ${path.relative(process.cwd(), process.argv[1])} <restart millisencods> <watch script> [parameters for watch script]`);
  error && console.error(error);
  process.exit(1);
}

if (process.argv.length < 4) {
  usage();
}

const waitTime = Number.parseInt(process.argv[2]);
if (Number.isNaN(waitTime) || waitTime <= 0) {
  usage('[restart millisencods] must be an integer and greater than 0');
}

class WatchDog {
  private waitingTimer?: NodeJS.Timeout | number;
  private waitingPromiseResolve?: () => void;

  private child?: ChildProcess;
  private childExitPromiseResolv?: () => void;

  private exit = false;

  constructor(private readonly argv: string[], private readonly waitTime: number) {
  }

  private wait(ms: number) {
    return new Promise<void>((resolve, reject) => {
      this.waitingPromiseResolve = resolve;
      this.waitingTimer = setTimeout(resolve, ms);
    });
  };

  private trimEnd(str: string | Buffer, ch: string) {
    if (typeof str === 'string') {
      return str.endsWith(ch) ? str.substring(0, str.length - ch.length) : str;
    } else {
      return this.trimEnd(str.toString('utf8'), ch);
    }
  }

  private startProcess() {
    console.log(`[ParentProcess][${process.pid}][SYS]: try to start a new child process command: ${this.argv.map(v => `"${v}"`).join(' ')}`);
    let child = spawn(this.argv[0], [...this.argv.slice(1)]);

    child.stdout.on('data', (data) => {
      console.log(`[ChildProcess][${child.pid}][LOG]: ${this.trimEnd(data, '\n')}`);
    });

    child.stderr.on('data', (data) => {
      console.error(`[ChildProcess][${child.pid}][ERR]: ${this.trimEnd(data, '\n')}`);
    });

    child.on('error', (err) => {
      console.error(`[ChildProcess][${child.pid}][SYS]:`);
      console.error(err);
      this.exit = true;
      this.stopWait();
    });

    child.on('close', (code) => {
      console.log(`[ChildProcess][${child.pid}][SYS]: exit with code(${code})`);
      this.onChildStopped();
    });

    return child;
  }

  private waitChildProcess() {
    return new Promise<void>((resolve) => {
      this.childExitPromiseResolv = resolve;
    });
  }

  private async killChild() {
    return new Promise<void>((resolve, reject) => {
      if (!this.child || this.child.killed) {
        return
      }

      console.log(`[ChildProcess][${this.child.pid}][SYS]: child process will exit`);
      this.child.kill('SIGTERM');
      this.childExitPromiseResolv = resolve;
    });
  }

  private onParentStop(signal: NodeJS.Signals) {
    console.log(`[ParentProcess][${process.pid}][SYS]: receive signal ${signal}, will exit child process and this process`);

    this.exit = true;
    this.stopWait();
    this.killChild();
  }

  private stopWait() {
    this.waitingTimer && clearTimeout(this.waitingTimer)
    this.waitingPromiseResolve && this.waitingPromiseResolve();
  }

  private onChildStopped() {
    this.childExitPromiseResolv && this.childExitPromiseResolv();
    this.child = undefined;

  }

  async start() {
    process.on('SIGINT', this.onParentStop.bind(this));
    process.on('SIGTERM', this.onParentStop.bind(this));

    do {
      const child = this.startProcess();
      this.child = child;
      console.log(`[ParentProcess][${process.pid}][SYS]: started a new child process pid(${child.pid})`);

      await this.waitChildProcess();

      console.log(`[ParentProcess][${process.pid}][SYS]: child process pid(${child.pid}) exit`);

      await this.wait(this.waitTime * 1000);

      // console.log(`[ParentProcess][${process.pid}][SYS]: wait for ${this.waitTime}s restart child process`);
      // await this.killChild();
    } while (!this.exit);
  }
}

const watchDog = new WatchDog(process.argv.slice(3), waitTime);
watchDog.start().catch(console.error);