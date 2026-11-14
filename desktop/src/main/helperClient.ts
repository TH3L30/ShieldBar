import net from 'node:net'
import { HELPER_PROTOCOL } from '../shared/constants'

export interface HelperResponse {
  ok: boolean
  protocol: number
  version?: string
  state?: string
  triggered?: boolean
  interfaces?: string[]
  message?: string
}

export function helperSocketPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\shieldbar-protection-helper'
  }
  if (process.platform === 'linux') {
    return '/run/shieldbar-helper.sock'
  }
  return '/var/run/com.local.shieldbar.helper.sock'
}

export class HelperClient {
  private readonly socketPath: string

  constructor(socketPath: string = helperSocketPath()) {
    this.socketPath = socketPath
  }

  async request(command: string, timeoutMs = 5_000): Promise<HelperResponse> {
    return await new Promise<HelperResponse>((resolve, reject) => {
      const socket = net.createConnection(this.socketPath)
      let buffer = ''
      let settled = false

      const finish = (error: Error | null, response?: HelperResponse): void => {
        if (settled) return
        settled = true
        socket.removeAllListeners()
        socket.destroy()
        if (error) reject(error)
        else if (response) resolve(response)
        else reject(new Error('The protection helper returned no response.'))
      }

      socket.setTimeout(timeoutMs)

      socket.on('connect', () => {
        socket.write(
          `${JSON.stringify({ command, protocol: HELPER_PROTOCOL })}\n`
        )
      })

      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8')
        const newline = buffer.indexOf('\n')
        if (newline === -1) return

        const line = buffer.slice(0, newline).trim()
        if (!line) return

        try {
          finish(null, JSON.parse(line) as HelperResponse)
        } catch {
          finish(new Error('The protection helper returned invalid data.'))
        }
      })

      socket.on('timeout', () => {
        finish(new Error('The protection helper did not respond in time.'))
      })

      socket.on('error', (error) => {
        finish(
          new Error(
            error.message.includes('ENOENT') ||
              error.message.includes('ECONNREFUSED')
              ? 'The protection helper is not installed or is not running.'
              : `Protection helper error: ${error.message}`
          )
        )
      })

      socket.on('end', () => {
        if (!settled) finish(new Error('The protection helper closed the connection.'))
      })
    })
  }

  async status(): Promise<HelperResponse> {
    return await this.request('status')
  }

  async disable(): Promise<HelperResponse> {
    return await this.request('disable', 45_000)
  }

  async restore(): Promise<HelperResponse> {
    return await this.request('restore', 60_000)
  }
}
