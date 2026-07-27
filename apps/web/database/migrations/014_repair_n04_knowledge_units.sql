UPDATE classroom_sessions
SET active_unit_id = CASE active_node_id
  WHEN 'P1T1-N04' THEN 'P01-ku-06'
  WHEN 'P1T2-N04' THEN 'P02-ku-06'
  WHEN 'P1T3-N04' THEN 'P03-ku-06'
END
WHERE (active_node_id = 'P1T1-N04' AND active_unit_id = 'P01-ku-04')
   OR (active_node_id = 'P1T2-N04' AND active_unit_id = 'P02-ku-04')
   OR (active_node_id = 'P1T3-N04' AND active_unit_id = 'P03-ku-04');

UPDATE classroom_commands
SET payload_json = json_set(
  payload_json,
  '$.unitId',
  CASE json_extract(payload_json, '$.nodeId')
    WHEN 'P1T1-N04' THEN 'P01-ku-06'
    WHEN 'P1T2-N04' THEN 'P02-ku-06'
    WHEN 'P1T3-N04' THEN 'P03-ku-06'
  END
)
WHERE (json_extract(payload_json, '$.nodeId') = 'P1T1-N04'
    AND json_extract(payload_json, '$.unitId') = 'P01-ku-04')
   OR (json_extract(payload_json, '$.nodeId') = 'P1T2-N04'
    AND json_extract(payload_json, '$.unitId') = 'P02-ku-04')
   OR (json_extract(payload_json, '$.nodeId') = 'P1T3-N04'
    AND json_extract(payload_json, '$.unitId') = 'P03-ku-04');
