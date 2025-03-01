# Lorentz Arena

A multiplayer combat game with special relativity effects.

![](image.webp)

```mermaid
sequenceDiagram
    participant Client1
    participant Server
    participant Client2

    Client1->>Server: WebSocket接続
    Server->>Client1: connected {clientId: "xxx"}
    Client2->>Server: WebSocket接続
    Server->>Client2: connected {clientId: "yyy"}

    Client1->>Server: offer {type: "offer", payload: RTCSessionDescription}
    Server->>Client2: offer {from: "xxx", payload: RTCSessionDescription}
    Client2->>Server: answer {type: "answer", payload: RTCSessionDescription}
    Server->>Client1: answer {from: "yyy", payload: RTCSessionDescription}

    Client1->>Server: candidate {type: "candidate", payload: RTCIceCandidate}
    Server->>Client2: candidate {from: "xxx", payload: RTCIceCandidate}
    Client2->>Server: candidate {type: "candidate", payload: RTCIceCandidate}
    Server->>Client1: candidate {from: "yyy", payload: RTCIceCandidate}

    Note over Client1,Client2: WebRTC DataChannel確立
    Client1->>Client2: テストメッセージ (DataChannel経由)
    Client2->>Client1: テストメッセージ (DataChannel経由)
```
