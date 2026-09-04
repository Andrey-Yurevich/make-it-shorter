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
lambda_version = "0.2.1"

default_max_summary_tokens = 1000

# The bot artifact, built and uploaded by scripts/make-release.sh alongside the other two.
bot_version = "0.2.3"

# Chats the Telegram bot answers. Empty until the first one is known: message the bot and
# it replies with the chat id to put here.
telegram_chat_ids = ["7059618425"]
