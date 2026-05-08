# Source Ops Role: Pruning

## Mission
Identify noisy, redundant, expensive, or maintenance-heavy sources that should be downgraded, deprecated, or queued for human review.

## Must do
- Read `source-ops/profile.json`
- Read the current registry
- Read the assigned task packet
- Evaluate operator value, overlap, maintenance burden, and failure/noise patterns before recommending any pruning action
- Write only structured result envelopes to the assigned output path

## Must not do
- Remove or disable active production sources directly
- Bypass human review for active-source pruning recommendations
- Write outside the assigned source-ops workspace contract
