# External implementation guidance consulted — 2026-10-12

These documents guided the software boundary controls. They do not certify this release or substantiate hardware-performance claims. Research attachments were inventoried and parsed separately; no paper is treated as proof that the browser executes on physical quantum/photonic hardware.

- Node.js release policy: https://nodejs.org/en/about/previous-releases — production users should select a supported Active/Maintenance LTS runtime.
- MDN Web Locks API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API — secure-context, worker-accessible, same-origin coordination; `ifAvailable` and lock lifetime.
- MDN StorageManager.persist: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist — storage persistence is requested and may be refused.
- OWASP HTML5 Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html — validate message data and maintain browser/storage trust boundaries.
- OWASP Content Security Policy Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html — restrictive CSP is defense in depth, not a replacement for input/output validation.
