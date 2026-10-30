# DataVision AI — GitHub & Free Hosting Guide (Step by Step)

Seedhi baat: **GitHub par upload karne se server khud nahi chalta** — GitHub sirf code store karta hai. Lekin GitHub ke saath 2 FREE tarike hain app ko online chalane ke:

| Kya chahiye | Kahan | Kya milega |
|---|---|---|
| Lite version (bina login) | **GitHub Pages** (free) | Live link jo kisi bhi browser me khulega |
| Full version (login, projects, admin) | **Render.com** (free) | Pura server online, GitHub se auto-deploy |

---

## STEP 1 — Code GitHub par upload karo

1. https://github.com par account banao (free).
2. Right-top **"+" → New repository** → naam do `datavision-ai` → **Public** → Create.
3. Upload ka aasaan tarika — **GitHub Desktop**:
   - https://desktop.github.com se install karo, login karo
   - **File → Add local repository** → apna `datavision-ai` folder choose karo
   - "Publish repository" dabao — done!
4. Ya command line se (agar Git installed hai):
   ```bash
   cd datavision-ai
   git init
   git add .
   git commit -m "DataVision AI - BCA project"
   git branch -M main
   git remote add origin https://github.com/APKA-USERNAME/datavision-ai.git
   git push -u origin main
   ```

> ⚠️ `.gitignore` already bana hua hai — `node_modules/`, `data/` aur `.env` upload NAHI honge (ye hona bhi chahiye: secrets aur users ka data kabhi GitHub par mat daalo).

---

## STEP 2 — Lite version ka FREE live link (GitHub Pages)

`docs/index.html` me Lite version ki copy already rakhi hai. Bas ye karo:

1. GitHub par apne repo me jao → **Settings** → left me **Pages**
2. "Source" me: **Deploy from a branch** → Branch: `main` → Folder: **/docs** → Save
3. 1–2 minute me link mil jayega:
   ```
   https://APKA-USERNAME.github.io/datavision-ai/
   ```
4. Ye link kisi ko bhi bhejo — upload → analysis → charts → PDF sab chalega! (login/projects nahi honge, wo server wali cheez hai)

College viva me ye link dikhane ke liye perfect hai. 📱 Mobile par bhi chalta hai.

---

## STEP 3 — Full version online (Render.com, free)

1. https://render.com par **GitHub se sign up** karo.
2. Dashboard → **New + → Web Service** → apna `datavision-ai` repo select karo.
3. Settings aise bharo (ya kuch mat chhedo — `render.yaml` already sab set kar deta hai):
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. **Create Web Service** dabao. 2–3 minute me link milega:
   ```
   https://datavision-ai-XXXX.onrender.com
   ```
5. Deploy ke baad Render dashboard → **Environment** me `ADMIN_PASSWORD` change kar dena.

### Free tier ki 2 limitations (imaandari se):
- **Sleep:** 15 min koi use na ho to server so jata hai — agla visitor aaye to 30–50 second me jagta hai. Viva se pehle khud ek baar khol lena. 😄
- **Data reset:** Free plan me disk permanent nahi hoti — har redeploy/restart par SQLite database aur uploaded files reset ho jati hain. Demo ke liye theek hai; permanent data ke liye paid disk ($) ya hosted database (Postgres/Supabase) lagega.

---

## Short me

- **GitHub = code ka ghar + portfolio** (recruiters ko repo link do)
- **GitHub Pages = Lite ka live link** (free, hamesha chalta hai, server nahi chahiye)
- **Render = full app ka live link** (free, thoda slow wake-up, demo ke liye best)
- **College demo laptop par = `start-windows.bat`** (sabse fast, internet ki zaroorat bhi nahi after install)
