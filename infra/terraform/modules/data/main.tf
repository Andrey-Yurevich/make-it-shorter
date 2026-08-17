# One table, two kinds of record told apart by the key prefix:
#   quota#<deviceId>#<YYYY-MM-DD>   daily counter, TTL +48h
#   device#<deviceId>               per-device overrides, no TTL, created by hand
resource "aws_dynamodb_table" "data" {
  name         = "mis-data"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  # Point-in-time recovery is here for the overrides, not the counters: counters
  # are ephemeral by design, while overrides are made by hand and could not be
  # recovered from anywhere if deleted by accident.
  point_in_time_recovery {
    enabled = true
  }
}

output "table_name" { value = aws_dynamodb_table.data.name }
output "table_arn" { value = aws_dynamodb_table.data.arn }
