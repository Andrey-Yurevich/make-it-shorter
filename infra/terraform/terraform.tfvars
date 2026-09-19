# Values for the single prod environment. There is no dev: it would double the
# infrastructure, domains and certificates for a stand nobody works on.

alarm_email = "andrei@yurevich.it"

# Which build production runs: the key of the artifact in S3, under lambda/ and without
# the .zip. make-release.sh prints that name when it finishes uploading — the
# version-shaped tag on the built commit, its short sha when there is no tag, and a -1,
# -2 on the end of either when the name was taken already.
#
# Deploying is editing this line and running terraform apply; the script does neither. A
# rollback is the same edit naming an older key, and works as long as that key is still
# in the bucket.
lambda_version = "2.2.0"

# Overrides the Sonnet 5 default in variables.tf. AWS applies a quota of 0 to this
# account for the whole recent premium row — Sonnet 5, Opus 5, Opus 4.7, Opus 4.8,
# Fable 5 and 5.1 — against an AWS default of 6,000,000 tokens per minute, so every
# ConverseStream call returns AccessDeniedException "not available for this account".
# The model agreement is accepted and every other axis reads AVAILABLE; only the quota
# is zero, and Service Quotas cannot lower a request back down to the default, so this
# is not self-service. Drop this line once AWS restores the quota.
default_model = "us.anthropic.claude-haiku-4-5-20251001-v1:0"

default_max_summary_tokens = 3000

# The bot artifact, built and uploaded by scripts/make-release.sh alongside the other two.
bot_version = "2.2.0"

# Chats the Telegram bot answers. Empty until the first one is known: message the bot and
# it replies with the chat id to put here.
telegram_chat_ids = ["7059618425"]
