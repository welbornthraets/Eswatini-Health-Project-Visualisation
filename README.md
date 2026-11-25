# Eswatini Health Project Visualisation

A password-protected website that maps where TB patients in Eswatini live and
where they died, with charts that break patients and deaths down by region,
age group, sex, HIV status, TB type and constituency.

**For internal use by the organisation only.**

## What it does

- **Map**: one circle per place, sized by number of patients and coloured by
  deaths (none / 1 / 2 or more). Click a circle for the details.
- **Charts**: the TB patient cohort dashboard (191 patients, its own data
  and filters): overview numbers, patients and outcomes by region, regional
  share, top constituencies, MDR-TB / HIV / helminth / mortality rings, TB
  type, HIV status, gender, age, mortality by risk factor, a region and
  constituency network, and a sortable table of patient records. If the
  cohort has a different password from the map, the Charts tab asks for it.
- **Filters** (left panel, map only): region, TB type, HIV status, sex, age
  group and constituency. Active filters show as chips you can remove one by one.
- **Copy link to this view**: the address keeps the current filters and tab,
  so you can send a colleague the exact view. They still need the password.
- **Download map (PNG)**: a picture of the map as it is on screen, with the
  title, active filters, headline numbers and legend. It is drawn in the
  browser after unlocking, so no unencrypted map is stored on the website.
- **Download summary (CSV)**: counts per constituency for the current
  filters. It never contains patient-level rows.
- **Add boundaries (GeoJSON)**: overlay district or constituency outlines
  from a local file.

## How the data is protected

The patient rows are stored only in encrypted form (`assets/tb-data.enc.js`,
AES-256-GCM with a key derived from the password by PBKDF2-SHA256, 250,000
iterations). The browser decrypts them after the password is typed; nothing
is sent to a server. The page asks search engines not to index it.

Because the encrypted file is publicly downloadable, **the password is the
only protection**. Use a long one (a phrase of 4 or more random words, or 16+
characters), share it only with people who need it, and change it (re-encrypt,
below) if it leaks or someone leaves.

## Admin page (`/admin`)

Admins sign in at **/admin** with their email and password. From there they can:

- **Upload a CSV** of patients (add to the existing data, or replace it), with a
  preview and a clear list of any rows with problems. Columns:
  `participant_id, area, constituency, region, tb_type, hiv_status, gender, age, helminth, status, lat, lon`
  (`helminth`, `lat`, `lon` may be empty; patients without a location are placed
  near others in the same area or constituency). A template is on the page.
- **Type in patients** one by one and upload them together.
- **Download all data** as CSV or JSON.
- **Change the viewer password.**
- **First time only:** combine the old map file and the old Charts file into one
  dataset that both the map and the Charts tab use.

Every change is encrypted in the admin's browser with the viewer password and
committed to `assets/tb-combined.enc.js` in this repository; Vercel redeploys and
the live site shows it in about a minute. The server never sees readable patient
data, and commit messages never name the admin or any patient. Every save is a
commit, so any upload can be undone from the repository history.

On the public site, *Add boundaries (GeoJSON)*, *Download summary (CSV)* and the
*Admin page* link are shown only to a signed-in admin.

### Setting it up in Vercel (once)

In Vercel → the project → **Settings → Environment Variables**, add these for
**Production**, then redeploy:

| Name | Value |
|------|-------|
| `ADMIN_ACCOUNTS` | from `python tools/make_admin_hash.py email1 email2` (password hashes only) |
| `SESSION_SECRET` | from the same command |
| `GITHUB_TOKEN` | a GitHub fine-grained token: *Repository access* = only this repository, *Permissions → Contents* = Read and write |

To add or remove an admin, or reset a password, run the tool again and replace
`ADMIN_ACCOUNTS`. Removing an email signs that admin out at once.

## Put it online (Vercel)

1. Sign in at **https://vercel.com** with your GitHub account.
2. Click **Add New… → Project**, find **Eswatini-Health-Project-Visualisation**
   and click **Import** (if it is not listed, click **Adjust GitHub App
   Permissions** and give Vercel access to this repository).
3. Leave **Framework Preset** as **Other**, leave the build and output
   settings empty, and click **Deploy**.
4. When it finishes, Vercel shows the address (for example
   `https://eswatini-health-project-visualisation.vercel.app`).

Every push to `main` redeploys the site automatically. `vercel.json` adds
security headers (Content-Security-Policy, no framing, `noindex`), and
`.vercelignore` keeps `tools/` and the README off the site.

## Or put it online with GitHub Pages

1. In this repository on GitHub go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**,
   pick **main** and **/ (root)**, and click **Save**.
3. After a minute or two the site is live at
   **https://welshamar.github.io/Eswatini-Health-Project-Visualisation/**

Every push to `main` updates the live site automatically. The old address
`tb_web_map.html` forwards to the new page.

## Update the cohort charts data

The Charts tab reads `assets/cohort-data.enc.js`. To replace it with a newer
cohort dashboard export, copy the `ENCRYPTED_PAYLOAD = {...}` object from that
dashboard's HTML into this file as `window.COHORT_PAYLOAD = {...};`. The data
stays encrypted with the cohort dashboard's password.

## Update the map data or change the password

You need the patient rows as a JSON array (one row per patient, the field
order is described at the top of `tools/encrypt_data.py`). Keep that file
**out of this repository**.

```bash
pip install cryptography
python tools/encrypt_data.py path/to/rows.json      # asks for the new password twice
git add assets/tb-data.enc.js && git commit -m "Update TB data" && git push
```

## Run it on your computer

The unlock step needs a secure page (https or localhost), so open it through a
small local web server rather than double-clicking the file:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Files

```
index.html             the page
assets/app.js          map, charts, filters, downloads
assets/app.css         styles (light and dark)
assets/tb-data.enc.js  the encrypted map data
assets/cohort.js       the Charts tab (cohort dashboard)
assets/cohort-data.enc.js  the encrypted cohort data for the Charts tab
assets/leaflet/        Leaflet 1.9.4 map library (served locally, no CDN)
tools/encrypt_data.py  encrypts new data / sets a new password
admin.html             the admin page (/admin)
api/                   admin sign-in and saving (Vercel functions)
assets/tbdata.js       the combined dataset: encryption, CSV import/export
assets/tb-combined.enc.js  the encrypted combined data (written by the admin page)
tools/make_admin_hash.py   makes admin password hashes for Vercel
tb_web_map.html        forwards old links to index.html
vercel.json            Vercel hosting settings and security headers
```
