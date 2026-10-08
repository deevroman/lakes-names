-- Convert natural=water OSM objects to a compact browser-friendly Parquet file.
--
-- Run from the repository root:
--   duckdb < export_water.sql
--
-- `osmium` reconstructs way and multipolygon geometries from the OSM PBF. The
-- geometry itself is intentionally omitted from the output; longitude and
-- latitude are a point on its surface, and area_m2 is geodesic area for polygons.

INSTALL spatial;
INSTALL osmium FROM community;
LOAD spatial;
LOAD osmium;

SET threads = 8;
SET geometry_always_xy = true;

COPY (
  SELECT
    type AS osm_type,
    id AS osm_id,
    tags['water'] AS water,
    tags['name'] AS name,
    tags['name:ru'] AS name_ru,
    tags['name:en'] AS name_en,
    tags['wikidata'] AS wikidata,
    tags['wikipedia'] AS wikipedia,
    tags['intermittent'] AS intermittent,
    tags['salt'] AS salt,
    tags['description'] AS description,
    tags['note'] AS note,
    ST_X(ST_PointOnSurface(geometry)) AS longitude,
    ST_Y(ST_PointOnSurface(geometry)) AS latitude,
    CASE WHEN kind = 'area' THEN CAST(ROUND(ST_Area_Spheroid(geometry)) AS BIGINT) END AS area_m2,
    to_json(tags) AS tags_json
  FROM osmium_read('water.pbf')
  WHERE kind IN ('node', 'area')
    AND tags['name'] IS NOT NULL
    AND tags['natural'] = 'water'
) TO 'data/water-objects.parquet'
(FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 10000);

SELECT
  COUNT(*) AS exported_objects,
  COUNT(*) FILTER (WHERE osm_type = 'node') AS nodes,
  COUNT(*) FILTER (WHERE osm_type = 'way') AS ways,
  COUNT(*) FILTER (WHERE osm_type = 'relation') AS relations,
  COUNT(area_m2) AS polygons_with_area
FROM read_parquet('data/water-objects.parquet');
