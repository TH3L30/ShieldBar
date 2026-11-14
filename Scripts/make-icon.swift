#!/usr/bin/env swift
import AppKit
import Foundation

// Draws the ShieldBar application icon from vector paths.
// Usage: swift make-icon.swift /path/to/AppIcon-1024.png

let outputPath = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : "AppIcon-1024.png"

let side: CGFloat = 1024
let canvas = NSRect(x: 0, y: 0, width: side, height: side)

guard let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: Int(side),
    pixelsHigh: Int(side),
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
) else {
    fatalError("Could not allocate icon bitmap")
}
rep.size = NSSize(width: side, height: side)

func color(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat, _ alpha: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: red / 255, green: green / 255, blue: blue / 255, alpha: alpha)
}

func shieldPath(in rect: NSRect) -> NSBezierPath {
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

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSColor.clear.setFill()
canvas.fill()

let background = NSBezierPath(roundedRect: canvas, xRadius: 228, yRadius: 228)
background.addClip()

NSGradient(colors: [
    color(20, 34, 62),
    color(8, 13, 25)
])?.draw(in: canvas, angle: -90)

let glowRect = NSRect(x: 92, y: 110, width: 840, height: 840)
NSGradient(colorsAndLocations:
    (color(28, 214, 178, 0.30), 0.0),
    (color(10, 132, 255, 0.10), 0.55),
    (color(0, 0, 0, 0.0), 1.0)
)?.draw(
    in: NSBezierPath(ovalIn: glowRect),
    relativeCenterPosition: NSPoint(x: 0, y: 0.04)
)

let ring = NSBezierPath(ovalIn: NSRect(x: 170, y: 150, width: 684, height: 684))
color(255, 255, 255, 0.055).setStroke()
ring.lineWidth = 3
ring.stroke()

let innerRing = NSBezierPath(ovalIn: NSRect(x: 218, y: 198, width: 588, height: 588))
color(255, 255, 255, 0.035).setStroke()
innerRing.lineWidth = 2
innerRing.stroke()

let shieldRect = NSRect(x: 252, y: 186, width: 520, height: 650)
let shield = shieldPath(in: shieldRect)

NSGraphicsContext.saveGraphicsState()
let shadow = NSShadow()
shadow.shadowColor = color(0, 0, 0, 0.55)
shadow.shadowBlurRadius = 48
shadow.shadowOffset = NSSize(width: 0, height: -22)
shadow.set()
NSGradient(colors: [
    color(43, 230, 183),
    color(10, 150, 255)
])?.draw(in: shield, angle: -72)
NSGraphicsContext.restoreGraphicsState()

color(255, 255, 255, 0.52).setStroke()
shield.lineWidth = 7
shield.stroke()

let check = NSBezierPath()
check.move(to: NSPoint(x: 397, y: 512))
check.line(to: NSPoint(x: 489, y: 420))
check.line(to: NSPoint(x: 652, y: 596))
check.lineWidth = 70
check.lineCapStyle = .round
check.lineJoinStyle = .round

NSGraphicsContext.saveGraphicsState()
let checkShadow = NSShadow()
checkShadow.shadowColor = color(0, 50, 70, 0.35)
checkShadow.shadowBlurRadius = 18
checkShadow.shadowOffset = NSSize(width: 0, height: -8)
checkShadow.set()
color(255, 255, 255, 0.98).setStroke()
check.stroke()
NSGraphicsContext.restoreGraphicsState()

let spark = NSBezierPath()
spark.appendArc(
    withCenter: NSPoint(x: 760, y: 780),
    radius: 46,
    startAngle: 35,
    endAngle: 125,
    clockwise: false
)
color(255, 255, 255, 0.32).setStroke()
spark.lineWidth = 9
spark.lineCapStyle = .round
spark.stroke()

NSGraphicsContext.restoreGraphicsState()

guard let png = rep.representation(using: .png, properties: [:]) else {
    fatalError("Could not encode icon PNG")
}

let outputURL = URL(fileURLWithPath: outputPath)
try FileManager.default.createDirectory(
    at: outputURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
)
try png.write(to: outputURL)
print("Wrote \(outputPath)")
