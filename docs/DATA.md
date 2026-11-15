# Data system

`data-src/canonical` contains maintained canonical catalogs. `data-src/generated` contains reproducible intermediates. `data-src/quarantine` contains rejected or uncertain records with reasons. Compressed source catalogs are indexed by `data-src/source-data-manifest.json` and are materialized only during maintenance or release preparation.

Production clients consume bounded files under `public/data/kri`, including PMTiles, compact search data, language packs and viewport POI shards.

Deduplication is conservative: records are merged only when entity type, category, normalized proper name and a strict spatial threshold agree. Uncertain records remain separate or quarantined.
