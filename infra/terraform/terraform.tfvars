# Values for the single prod environment. There is no dev: it would double the
# infrastructure, domains and certificates for a stand nobody works on.

alarm_email = "andrei@yurevich.it"

# The unpacked development build, loaded from apps/extension/dist. With no key in the
# manifest Chrome derives the id from the absolute path of that folder, so this value
# holds as long as the checkout stays where it is — moving or renaming it mints a new id.
#
# It is temporary by construction: the rule admits exactly one Origin, and the Chrome Web
# Store item will have an id of its own, derived from the key pair the store generates.
# Creating that item is what replaces this value, and then EXTENSION_KEY makes the
# unpacked build answer to the released id instead of to its path.
extension_id = "bgidfchfjfnfebcoadoanjhhmcbkehhe"

# Which build production runs: the key of the artifact in S3, under lambda/ and without
# the .zip. make-release.sh prints that name when it finishes uploading — the
# version-shaped tag on the built commit, its short sha when there is no tag, and a -1,
# -2 on the end of either when the name was taken already.
#
# Deploying is editing this line and running terraform apply; the script does neither. A
# rollback is the same edit naming an older key, and works as long as that key is still
# in the bucket.
lambda_version = "76d34fb"
