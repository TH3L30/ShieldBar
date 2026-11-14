import { StatusEvaluator } from '../core/evaluator'
import { BrowserLeaksProbe } from './probe'

function write(line: string): void {
  process.stdout.write(`${line}\n`)
}

function redact(address: string): string {
  if (address.includes(':')) return 'IPv6 present (hidden)'
  const parts = address.split('.')
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.x.x`
  return 'present (hidden)'
}

/**
 * Live integration check against BrowserLeaks. Prints only redacted addresses.
 * A red/amber strict verdict is a valid finding, not a failure.
 */
export async function runSelfTest(): Promise<number> {
  write('ShieldBar self-test')
  write('Loading https://browserleaks.com/ip in an offscreen Chromium window…')
  write('')

  const startedAt = Date.now()
  const probe = new BrowserLeaksProbe()

  try {
    const report = await probe.probe()
    const evaluation = StatusEvaluator.evaluate(report)
    const duration = (Date.now() - startedAt) / 1000

    write(`Page IP:              ${redact(report.pageIPv4)}`)
    write(`IPv6:                 ${report.pageIPv6 ? 'detected' : 'not detected'}`)
    write(`Location:             ${[report.city, report.region, report.country].filter(Boolean).join(', ') || 'unknown'}`)
    write(`ISP:                  ${report.isp ?? 'unknown'}`)
    write(`WebRTC supported:     ${report.rtcSupported}`)
    write(`WebRTC completed:     ${report.rtcTestCompleted}`)
    write(`Local IPs exposed:    ${report.rtcLocal.length}`)
    write(`WebRTC public IPs:    ${report.rtcPublic.length}`)
    write(`Public mismatches:    ${evaluation.publicMismatch.length}`)
    write(`Strict result:        ${evaluation.headline}`)
    write(`Verdict detail:       ${evaluation.detail}`)
    write(`Check duration:       ${duration.toFixed(1)}s`)
    write('')

    const passed =
      report.rtcSupported &&
      report.rtcTestCompleted &&
      report.pageIPv4.length > 0

    if (passed) {
      write('PASS: BrowserLeaks loaded and the IP + WebRTC results were readable.')
      write('A red or amber strict verdict is a valid finding, not a test failure.')
    } else {
      write('FAIL: The page loaded but a complete IP + WebRTC result was not available.')
    }

    return passed ? 0 : 1
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    write(`FAIL: ${message}`)
    return 1
  }
}
