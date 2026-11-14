// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ShieldBar",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "ShieldBar", targets: ["ShieldBar"]),
        .library(name: "ShieldBarCore", targets: ["ShieldBarCore"])
    ],
    targets: [
        .target(
            name: "ShieldBarCore",
            path: "Sources/ShieldBarCore"
        ),
        .executableTarget(
            name: "ShieldBar",
            dependencies: ["ShieldBarCore"],
            path: "Sources/ShieldBar"
        ),
        .testTarget(
            name: "ShieldBarCoreTests",
            dependencies: ["ShieldBarCore"],
            path: "Tests/ShieldBarCoreTests"
        )
    ]
)
