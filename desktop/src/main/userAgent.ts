export function chromeUserAgent(): string {
  const chrome = process.versions.chrome ?? '140.0.0.0'
  let platform = 'X11; Linux x86_64'
  if (process.platform === 'win32') {
    platform = 'Windows NT 10.0; Win64; x64'
  } else if (process.platform === 'darwin') {
    platform = 'Macintosh; Intel Mac OS X 10_15_7'
  }
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
}
