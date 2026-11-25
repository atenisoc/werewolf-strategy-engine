## What this changes

## Measurement (for anything that touches behaviour)

```
node dist/sim.js --compare <variant> --n <size> --games 2000
(paste output; include every size you tested)
```

## Checklist
- [ ] `npm run build && npm test` pass
- [ ] `npm run typecheck` passes
- [ ] Agent code reads only `PlayerObservation` (no `GameState`), no `Math.random()`
- [ ] Changed weights have updated comments with the measured effect
