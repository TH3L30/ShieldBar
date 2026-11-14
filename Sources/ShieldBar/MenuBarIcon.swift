import AppKit
import ShieldBarCore
import SwiftUI

enum MenuBarIcon {
    static let baseSize: CGFloat = 18

    static func image(for status: ShieldStatus, size: CGFloat = baseSize) -> NSImage {
        let scale: CGFloat = 2
        let pixelSize = max(1, Int((size * scale).rounded()))
        guard let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: pixelSize,
            pixelsHigh: pixelSize,
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        ) else {
            return NSImage(size: NSSize(width: size, height: size))
        }
        rep.size = NSSize(width: size, height: size)

        NSGraphicsContext.saveGraphicsState()
        if let context = NSGraphicsContext(bitmapImageRep: rep) {
            NSGraphicsContext.current = context
            draw(status: status, in: NSRect(x: 0, y: 0, width: size, height: size))
            context.flushGraphics()
        }
        NSGraphicsContext.restoreGraphicsState()

        let image = NSImage(size: NSSize(width: size, height: size))
        image.addRepresentation(rep)
        image.isTemplate = false
        return image
    }

    private static func draw(status: ShieldStatus, in rect: NSRect) {
        let unit = rect.width / baseSize
        let shieldRect = NSRect(
            x: rect.minX + 1.15 * unit,
            y: rect.minY + 0.7 * unit,
            width: 15.7 * unit,
            height: 16.4 * unit
        )
        let shield = shieldPath(in: shieldRect)
        let accent = color(for: status)

        accent.setFill()
        shield.fill()

        NSColor.black.withAlphaComponent(0.28).setStroke()
        shield.lineWidth = 0.55 * unit
        shield.stroke()

        NSColor.white.withAlphaComponent(0.22).setStroke()
        let inner = shieldPath(in: shieldRect.insetBy(dx: 0.7 * unit, dy: 0.7 * unit))
        inner.lineWidth = 0.45 * unit
        inner.stroke()

        drawGlyph(for: status, in: shieldRect, unit: unit)
    }

    private static func drawGlyph(for status: ShieldStatus, in rect: NSRect, unit: CGFloat) {
        let glyphColor: NSColor
        switch status {
        case .inconclusive:
            glyphColor = NSColor(srgbRed: 0.20, green: 0.13, blue: 0.0, alpha: 1)
        default:
            glyphColor = .white
        }
        glyphColor.setStroke()
        glyphColor.setFill()

        func point(_ x: CGFloat, _ y: CGFloat) -> NSPoint {
            NSPoint(
                x: rect.minX + rect.width * (x / 18.0),
                y: rect.minY + rect.height * (y / 18.0)
            )
        }

        switch status {
        case .clear:
            let check = NSBezierPath()
            check.move(to: point(5.5, 8.8))
            check.line(to: point(7.9, 6.3))
            check.line(to: point(12.6, 11.7))
            check.lineWidth = 1.85 * unit
            check.lineCapStyle = .round
            check.lineJoinStyle = .round
            check.stroke()

        case .publicLeak:
            let cross = NSBezierPath()
            cross.move(to: point(6.2, 6.6))
            cross.line(to: point(11.8, 12.2))
            cross.move(to: point(11.8, 6.6))
            cross.line(to: point(6.2, 12.2))
            cross.lineWidth = 1.9 * unit
            cross.lineCapStyle = .round
            cross.stroke()

        case .localExposure:
            let bang = NSBezierPath()
            bang.move(to: point(9.0, 12.2))
            bang.line(to: point(9.0, 8.0))
            bang.lineWidth = 1.9 * unit
            bang.lineCapStyle = .round
            bang.stroke()

            let dot = NSBezierPath(
                ovalIn: NSRect(
                    x: point(9.0, 5.9).x - 1.0 * unit,
                    y: point(9.0, 5.9).y - 1.0 * unit,
                    width: 2.0 * unit,
                    height: 2.0 * unit
                )
            )
            dot.fill()

        case .inconclusive:
            let question = "?" as NSString
            let font = NSFont.systemFont(ofSize: 10.8 * unit, weight: .heavy)
            let attributes: [NSAttributedString.Key: Any] = [
                .font: font,
                .foregroundColor: glyphColor
            ]
            let textSize = question.size(withAttributes: attributes)
            let origin = NSPoint(
                x: rect.midX - textSize.width / 2,
                y: rect.midY - textSize.height / 2 + 0.4 * unit
            )
            question.draw(at: origin, withAttributes: attributes)

        case .offline:
            let dash = NSBezierPath()
            dash.move(to: point(6.1, 9.4))
            dash.line(to: point(11.9, 9.4))
            dash.lineWidth = 1.9 * unit
            dash.lineCapStyle = .round
            dash.stroke()

        case .checking:
            for x in [6.2, 9.0, 11.8] {
                let dot = NSBezierPath(
                    ovalIn: NSRect(
                        x: point(CGFloat(x), 9.3).x - 0.85 * unit,
                        y: point(CGFloat(x), 9.3).y - 0.85 * unit,
                        width: 1.7 * unit,
                        height: 1.7 * unit
                    )
                )
                dot.fill()
            }

        case .idle:
            let dot = NSBezierPath(
                ovalIn: NSRect(
                    x: rect.midX - 1.0 * unit,
                    y: rect.midY - 1.0 * unit,
                    width: 2.0 * unit,
                    height: 2.0 * unit
                )
            )
            dot.fill()
        }
    }

    static func shieldPath(in rect: NSRect) -> NSBezierPath {
        let path = NSBezierPath()
        func point(_ x: CGFloat, _ y: CGFloat) -> NSPoint {
            NSPoint(
                x: rect.minX + rect.width * x,
                y: rect.minY + rect.height * y
            )
        }

        path.move(to: point(0.5, 1.0))
        path.curve(
            to: point(0.93, 0.83),
            controlPoint1: point(0.68, 1.0),
            controlPoint2: point(0.87, 0.94)
        )
        path.line(to: point(0.93, 0.47))
        path.curve(
            to: point(0.5, 0.02),
            controlPoint1: point(0.93, 0.26),
            controlPoint2: point(0.76, 0.08)
        )
        path.curve(
            to: point(0.07, 0.47),
            controlPoint1: point(0.24, 0.08),
            controlPoint2: point(0.07, 0.26)
        )
        path.line(to: point(0.07, 0.83))
        path.curve(
            to: point(0.5, 1.0),
            controlPoint1: point(0.13, 0.94),
            controlPoint2: point(0.32, 1.0)
        )
        path.close()
        return path
    }

    static func color(for status: ShieldStatus) -> NSColor {
        switch status {
        case .clear:
            return NSColor(srgbRed: 0.16, green: 0.78, blue: 0.42, alpha: 1)
        case .publicLeak:
            return NSColor(srgbRed: 1.00, green: 0.27, blue: 0.23, alpha: 1)
        case .localExposure:
            return NSColor(srgbRed: 1.00, green: 0.62, blue: 0.04, alpha: 1)
        case .inconclusive:
            return NSColor(srgbRed: 0.97, green: 0.71, blue: 0.00, alpha: 1)
        case .offline:
            return NSColor(srgbRed: 0.56, green: 0.56, blue: 0.59, alpha: 1)
        case .checking:
            return NSColor(srgbRed: 0.04, green: 0.52, blue: 1.00, alpha: 1)
        case .idle:
            return NSColor(srgbRed: 0.62, green: 0.62, blue: 0.65, alpha: 1)
        }
    }
}

extension ShieldStatus {
    var displayColor: Color {
        Color(nsColor: MenuBarIcon.color(for: self))
    }

    var shortLabel: String {
        switch self {
        case .clear: return "Clear"
        case .publicLeak: return "Public leak"
        case .localExposure: return "Local IP exposed"
        case .inconclusive: return "Inconclusive"
        case .offline: return "Offline"
        case .checking: return "Checking"
        case .idle: return "Not checked"
        }
    }

    var accessibilityDescription: String {
        switch self {
        case .clear:
            return "Clear. WebRTC matches the public IP and no local IP is exposed."
        case .publicLeak:
            return "Public IP leak. WebRTC sees a different public IP."
        case .localExposure:
            return "Local IP exposed. WebRTC can see a private address."
        case .inconclusive:
            return "Inconclusive. The WebRTC test did not return enough data to judge."
        case .offline:
            return "Offline. BrowserLeaks could not be reached."
        case .checking:
            return "Checking BrowserLeaks now."
        case .idle:
            return "Not checked yet."
        }
    }

    var systemImageName: String {
        switch self {
        case .clear: return "checkmark.shield.fill"
        case .publicLeak: return "xmark.shield.fill"
        case .localExposure: return "exclamationmark.shield.fill"
        case .inconclusive: return "questionmark.diamond.fill"
        case .offline: return "wifi.slash"
        case .checking: return "arrow.triangle.2.circlepath"
        case .idle: return "shield"
        }
    }
}
