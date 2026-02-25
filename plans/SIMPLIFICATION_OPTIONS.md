# Simplification Options for Rewrite

Here are 3 approaches ranging from "minimal changes" to "full rewrite":

---

## Option A: Minimal Fixes (Keep Current Structure)

**Effort**: Low  
**Files Modified**: 3  
**Lines Changed**: ~100

### What We Do

Just fix the critical bugs without restructuring:

1. **Fix header race condition** in `service-worker.js:935`
   ```javascript
   // OLD (buggy):
   delete pendingReqHeaders[requestId];
   
   // NEW (fixed):
   setTimeout(() => delete pendingReqHeaders[requestId], 60000);
   ```

2. **Move FORBIDDEN_HEADERS** to content script only
   - Remove from service worker
   - Content script filters headers (as you requested)

3. **Cache content script ready state**
   ```javascript
   const contentScriptReady = new Map();
   ```

### Result
- Same file structure
- Same behavior
- Just fewer bugs

---

## Option B: Modular Monolith (Recommended)

**Effort**: Medium  
**Files Created**: 6  
**Files Modified**: 4

### New Structure

```
src/
├── service-worker.js          # thinner, imports modules
├── content-script.js          # same location
├── popup.js                   # same location
├── popup.html                 # same location
└── modules/
    ├── constants.js           # all constants in one place
    ├── headers.js             # header utilities
    ├── storage.js             # storage wrapper
    └── hls-parser.js          # HLS parsing logic
```

### What We Do

1. Extract constants to `modules/constants.js`
2. Extract storage logic to `modules/storage.js`
3. Extract HLS parsing to `modules/hls-parser.js`
4. Service worker becomes a thin coordinator

### Key Improvement

```javascript
// BEFORE: Everything in one 1149-line file
// service-worker.js had: constants, storage, parsing, commands, downloads

// AFTER: Clear separation
import { HLS_MIME_TYPES } from './modules/constants.js';
import { storage } from './modules/storage.js';
import { parseHLSPlaylist } from './modules/hls-parser.js';
```

### Result
- Easier to test individual functions
- Clear where to find things
- Still one extension, just organized better

---

## Option C: Full Component Architecture (Most Complex)

**Effort**: High  
**Files Created**: 15+  
**New Concepts**: Reactive state, component-based UI

### New Structure

```
src/
├── background/
│   ├── index.js
│   ├── capture.js
│   ├── storage.js
│   ├── commands.js
│   └── downloads.js
├── content/
│   ├── index.js
│   └── fetcher.js
├── popup/
│   ├── index.js
│   ├── store.js          # reactive state
│   └── components/
│       ├── App.js
│       ├── StreamList.js
│       └── CommandBar.js
└── shared/
    ├── constants.js
    └── headers.js
```

### What We Do

1. Full ES module architecture
2. Reactive state management in popup
3. Component-based UI (like React but vanilla JS)
4. Event-driven messaging

### Key Improvement

```javascript
// popup/store.js - reactive state
const store = {
  state: {
    streams: [],
    selectedStreamId: null
  },
  listeners: [],
  
  setState(update) {
    this.state = { ...this.state, ...update };
    this.listeners.forEach(cb => cb(this.state));
  },
  
  subscribe(callback) {
    this.listeners.push(callback);
  }
};

// Component re-renders automatically when state changes
store.subscribe(newState => {
  renderStreamList(newState.streams);
});
```

### Result
- Most maintainable long-term
- Easier to add features
- More complex initial setup

---

## Comparison Table

| Aspect | Option A (Minimal) | Option B (Modular) | Option C (Full) |
|--------|-------------------|-------------------|-----------------|
| Time to implement | 1-2 hours | 1-2 days | 3-5 days |
| Files changed | 3 | 10 | 20+ |
| New concepts to learn | 0 | Few (modules) | Many (reactivity) |
| Future maintainability | Low | Medium | High |
| Testability | Poor | Good | Excellent |
| Risk of breaking | Low | Medium | Higher |

---

## My Recommendation

**Go with Option B (Modular Monolith)** because:

1. Fixes the bugs you care about
2. Makes the code understandable
3. Doesn't over-engineer
4. Can evolve to Option C later if needed

**Skip Option A** if: You plan to maintain this long-term  
**Skip Option C** if: You just want it working reliably

---

## Alternative: Hybrid Approach

Do Option B in phases:

**Phase 1** (30 min): Fix critical bugs (Option A)  
**Phase 2** (2 hours): Extract constants and headers  
**Phase 3** (1 day): Extract storage and HLS parser  
**Phase 4** (optional): Component-based popup

This lets you stop at any point and still have working code.

Which approach appeals to you?