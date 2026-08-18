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

# Temporary key: the working tree is not committed yet, so there is no git sha
# that describes this build. Re-release through make-release.sh after committing.
lambda_version = "dev-3f78a2cd8e5a"
