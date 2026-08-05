## Summary

<!-- What this PR does and why. Ground it in the actual change, not the diff mechanics. -->

## Changes

<!-- The substantive changes, grouped by layer — adapter, engine (pivot/project/sections/format),
     components, build/tooling. Naming the layer is the most useful thing you can do for a reviewer.

     The adapter seam is the architecture: an adapter produces a NormalizedReport and nothing more,
     and the presentation walk, subtotal footing, and projection are identical for every source. If
     this PR adds a source-specific branch inside pivot/project/a component, say so explicitly and
     explain what prevented an adapter-level fix. -->

-

## Consumer Impact

<!-- Required judgment, not an optional section. Pre-1.0, but roboledger-app and
     robosystems-holon-viewer both consume this in production, so exports are a real contract.
     - BREAKING: a removed or renamed export, a changed prop, or altered rendered structure that
       consumer CSS or tests depend on. Renames and removals are breaking even pre-1.0.
     - ADDITIVE: new exports, new optional props, a new adapter.
     - INTERNAL: engine refactors, tests, tooling leaving the exported surface and output identical.

     CHANGED NUMBERS get their own line, always. If this alters a rendered value, a subtotal, a
     scaling or formatting rule, or footCheck behavior, give a before/after — consumers reconcile
     real statements against this output. -->

INTERNAL

## Testing

<!-- How the change was verified. Run `npm run test:all` (format:check -> lint -> typecheck -> test
     -> build) before opening; the gate is CHECK-ONLY, so fix and re-stage rather than expecting it
     to rewrite for you. CI runs the same gate on Node 22 and 24 plus a "dist loads under Node ESM"
     step.

     A rendering change is not done without a fixture that pins it. Say which fixtures cover this.
     "Not run" is a valid answer; a claimed pass that did not happen is not. -->
