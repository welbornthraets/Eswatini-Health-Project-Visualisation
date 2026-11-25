"""Make the ADMIN_ACCOUNTS value (and a SESSION_SECRET) for Vercel.

    python tools/make_admin_hash.py kibwotawelborn3@gmail.com geezmthethwa@gmail.com
        -> makes a new random 12-character password for each email

    python tools/make_admin_hash.py --set someone@example.com
        -> asks you to type the password yourself

Copy the printed ADMIN_ACCOUNTS and SESSION_SECRET into Vercel -> Project -> Settings ->
Environment Variables, then redeploy. Only the password hashes go to Vercel; give each
admin their own password privately. Never commit any of this output to the repository.
"""
import argparse, base64, getpass, hashlib, secrets, string

N, R, P = 16384, 8, 1
ALPHABET = string.ascii_letters + string.digits + "!@#%*?-_"

def new_password(length=12):
    while True:
        pw = "".join(secrets.choice(ALPHABET) for _ in range(length))
        # at least one lowercase, uppercase, digit and symbol
        if (any(c.islower() for c in pw) and any(c.isupper() for c in pw)
                and any(c.isdigit() for c in pw) and any(c in "!@#%*?-_" for c in pw)):
            return pw

def hash_password(pw):
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=N, r=R, p=P, maxmem=256 * 1024 * 1024, dklen=32)
    return f"scrypt:{N}:{R}:{P}:{base64.b64encode(salt).decode()}:{base64.b64encode(h).decode()}"

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("emails", nargs="+")
    ap.add_argument("--set", action="store_true", help="type each password instead of generating one")
    args = ap.parse_args()
    entries = []
    for email in args.emails:
        email = email.strip().lower()
        if args.set:
            pw = getpass.getpass(f"Password for {email}: ")
            if len(pw) < 12:
                raise SystemExit("Use at least 12 characters.")
        else:
            pw = new_password()
            print(f"Password for {email}: {pw}")
        entries.append(f"{email}={hash_password(pw)}")
    print("\nADMIN_ACCOUNTS=" + ";".join(entries))
    print("SESSION_SECRET=" + secrets.token_urlsafe(48))

if __name__ == "__main__":
    main()
