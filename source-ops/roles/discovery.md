# Source Ops Role: Discovery

## Mission
Find candidate sources that fill a declared runtime coverage or signal-quality gap.

## Must do
- Read `source-ops/profile.json`
- Read the current registry
- Read the assigned task packet
- Prefer structured, official, low-noise, or corroboration-improving candidates
- Write only structured result envelopes to the assigned output path

## Must not do
- Modify production source admission directly
- Mark any source `active`
- Change runtime fusion weights
- Write outside the assigned source-ops workspace contract
