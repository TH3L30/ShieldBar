import type { BrowserLeaksReport, StatusEvaluation } from './models'
import {
  pageAddresses,
  reportLocalAddresses,
  reportPublicAddresses
} from './models'
import { IPAddressNormalizer } from './ip'

/**
 * Strict status evaluator. Green is only possible when the WebRTC test
 * completed, the page returned a public address, every WebRTC public address
 * matches a page address after normalization, and no local address is exposed.
 */
export const StatusEvaluator = {
  evaluate(report: BrowserLeaksReport): StatusEvaluation {
    const page = pageAddresses(report)
    const publicAddresses = reportPublicAddresses(report)
    const localAddresses = reportLocalAddresses(report)

    if (!report.rtcSupported) {
      return {
        status: 'inconclusive',
        headline: 'Inconclusive',
        detail:
          'This Chromium build did not expose RTCPeerConnection, so the WebRTC leak test could not run.',
        publicMismatch: [],
        localExposed: localAddresses,
        publicAddresses,
        pageAddresses: page
      }
    }

    if (!report.rtcTestCompleted) {
      return {
        status: 'inconclusive',
        headline: 'Inconclusive',
        detail:
          'The BrowserLeaks WebRTC test did not finish. The page may have changed, or the test may be blocked.',
        publicMismatch: [],
        localExposed: localAddresses,
        publicAddresses,
        pageAddresses: page
      }
    }

    if (page.length === 0) {
      return {
        status: 'inconclusive',
        headline: 'Inconclusive',
        detail: 'BrowserLeaks did not return a public IP to compare against.',
        publicMismatch: [],
        localExposed: localAddresses,
        publicAddresses,
        pageAddresses: page
      }
    }

    if (publicAddresses.length === 0) {
      return {
        status: 'inconclusive',
        headline: 'Inconclusive',
        detail:
          'No public WebRTC candidate was returned. UDP or STUN may be blocked on this network.',
        publicMismatch: [],
        localExposed: localAddresses,
        publicAddresses,
        pageAddresses: page
      }
    }

    const pageKeys = new Set(
      page
        .map((address) => IPAddressNormalizer.key(address))
        .filter((key): key is string => key !== null)
    )

    const mismatch = publicAddresses.filter((address) => {
      const key = IPAddressNormalizer.key(address)
      return key === null || !pageKeys.has(key)
    })

    if (mismatch.length > 0) {
      return {
        status: 'publicLeak',
        headline: 'Public IP leak',
        detail:
          'WebRTC sees a different public IP than BrowserLeaks. If you are using a VPN or proxy, traffic may be bypassing it.',
        publicMismatch: mismatch,
        localExposed: localAddresses,
        publicAddresses,
        pageAddresses: page
      }
    }

    if (localAddresses.length > 0) {
      return {
        status: 'localExposure',
        headline: 'Local IP exposed',
        detail:
          'WebRTC exposed a local/private IP, but the public IP matches BrowserLeaks. This is a privacy exposure, not a public-IP leak.',
        publicMismatch: [],
        localExposed: localAddresses,
        publicAddresses,
        pageAddresses: page
      }
    }

    return {
      status: 'clear',
      headline: 'Clear',
      detail:
        'The WebRTC test sees the same public IP as BrowserLeaks, and no local IPs were exposed.',
      publicMismatch: [],
      localExposed: [],
      publicAddresses,
      pageAddresses: page
    }
  }
}
