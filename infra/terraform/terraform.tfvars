# Values for the single prod environment. There is no dev: it would double the
# infrastructure, domains and certificates for a stand nobody works on.

alarm_email = "andrei@yurevich.it"

# Placeholder until the extension is packed and gets its stable key. Until it is
# real, every request through CloudFront is blocked by the WAF Origin rule, and
# the function is reachable only by a signed direct call.
extension_id = "0000000000000000000000000000000a"

# Temporary key: the working tree is not committed yet, so there is no git sha
# that describes this build. Re-release through make-release.sh after committing.
lambda_version = "dev-3f78a2cd8e5a"
