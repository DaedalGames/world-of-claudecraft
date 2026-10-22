# Map audit sources for #4593

Source files Reuben's agent asked for on the Skynet map-audit thread. This
branch holds only these files; it is not meant to be merged.

| File | Source | SHA-256 |
|---|---|---|
| `woc-map_c5427ab37cc.map.json` | `map.json` from Duallam/woc-map at c5427ab37cc, byte for byte (git blob 3d8ea5c90830) | 167b46b95c8797bca65df100955d5b6a209263fae56c0bc264c794bafa242d51 |
| `eastbrook-and-mirefen-changes_20261020T0115Z.map.json` | `map.json` from Jamie's local `eastbrook-and-mirefen-changes.wocmap.zip` (meta.updatedAt 2026-10-20 01:15 UTC, meta.basedOn.base ea1802271a1c), byte for byte (zip CRC32 0x766c32ca) | 0b753e684eee666c1bab9239970446521d0f10429409d7a1dda9052502bd382b |

The zip also held an unrelated PDF, which is left out. To rebuild a
`.wocmap.zip`, zip a `map.json` at the archive root.
