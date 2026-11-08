require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error("Configurez JWT_SECRET dans .env (au moins 32 caractères).");
  process.exit(1);
}
const uploadDir = path.resolve(process.env.UPLOAD_DIR || "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/api/", rateLimit({ windowMs: 15 * 60 * 1000, limit: 180 }));

const db = new Database("jobconnect.sqlite");
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('candidate','recruiter','admin')),
 company TEXT, country TEXT, cv_path TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS jobs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, recruiter_id INTEGER NOT NULL REFERENCES users(id),
 title TEXT NOT NULL, company TEXT NOT NULL, description TEXT NOT NULL, country TEXT NOT NULL,
 city TEXT, contract_type TEXT NOT NULL, workplace TEXT DEFAULT 'On-site',
 salary TEXT, category TEXT, status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS applications (
 id INTEGER PRIMARY KEY AUTOINCREMENT, reference TEXT NOT NULL UNIQUE,
 job_id INTEGER REFERENCES jobs(id), candidate_id INTEGER REFERENCES users(id), full_name TEXT NOT NULL, email TEXT NOT NULL,
 phone TEXT, nationality TEXT, residence_country TEXT, target_country TEXT NOT NULL,
 profession TEXT NOT NULL, contract_type TEXT NOT NULL, experience TEXT, message TEXT,
 cv_path TEXT, status TEXT NOT NULL DEFAULT 'received',
 admin_note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_app_ref ON applications(reference);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE TABLE IF NOT EXISTS subscriptions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
 plan TEXT NOT NULL CHECK(plan IN ('candidate_premium','recruiter_premium')),
 amount_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'USD',
 status TEXT NOT NULL DEFAULT 'pending_payment',
 provider TEXT, provider_reference TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
`);
try { db.exec("ALTER TABLE users ADD COLUMN cv_path TEXT"); } catch {}
const q = (sql) => db.prepare(sql);
const safeUser = u => ({ id:u.id, name:u.name, email:u.email, role:u.role, company:u.company, country:u.country });
const sign = u => jwt.sign({ id:u.id, role:u.role }, SECRET, { expiresIn:"12h" });
function auth(req,res,next) {
  const h = req.headers.authorization || "";
  try {
    if (!h.startsWith("Bearer ")) throw new Error();
    req.user = jwt.verify(h.slice(7), SECRET);
    next();
  } catch { res.status(401).json({error:"Authentification requise."}); }
}
const allow = (...roles) => (req,res,next) => roles.includes(req.user.role) ? next() : res.status(403).json({error:"Accès non autorisé."});
const storage = multer.diskStorage({
  destination: (_,__,cb) => cb(null, uploadDir),
  filename: (_,file,cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase())
});
const upload = multer({
  storage, limits:{fileSize:5*1024*1024},
  fileFilter: (_,file,cb) => {
    const ok = [".pdf",".doc",".docx"].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error("Format CV non accepté. Utilisez PDF, DOC ou DOCX."), ok);
  }
});
app.use("/uploads", auth, allow("admin"), express.static(uploadDir));

// Compte administrateur initial : à modifier immédiatement en production.
(async () => {
  const email = process.env.ADMIN_EMAIL || "admin@jobconnect.example";
  const password = process.env.ADMIN_PASSWORD;
  if (password && !q("SELECT id FROM users WHERE email=?").get(email)) {
    const hash = await bcrypt.hash(password, 12);
    q("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')").run("Administrateur",email,hash);
    console.log("Compte administrateur initial créé :", email);
  }
})();

app.post("/api/auth/register", upload.single("cv"), async (req,res) => {
  const {name,email,password,role,company,country} = req.body || {};
  if (!name || !email || !password || password.length < 10 || !["candidate","recruiter"].includes(role) || (role === "candidate" && !req.file))
    return res.status(400).json({error:"Informations invalides. Mot de passe : 10 caractères minimum."});
  try {
    const hash = await bcrypt.hash(password,12);
    const result = q("INSERT INTO users(name,email,password_hash,role,company,country,cv_path) VALUES(?,?,?,?,?,?,?)")
      .run(name.trim(),email.toLowerCase().trim(),hash,role,company || null,country || null,role === "candidate" ? req.file.filename : null);
    const user = q("SELECT * FROM users WHERE id=?").get(result.lastInsertRowid);
    res.status(201).json({token:sign(user),user:safeUser(user)});
  } catch { res.status(409).json({error:"Cette adresse e-mail est déjà utilisée."}); }
});
app.get("/api/admin/users/:id/cv",auth,allow("admin"),(req,res)=>{ const u=q("SELECT cv_path FROM users WHERE id=? AND role=?").get(req.params.id,"candidate"); if(!u?.cv_path) return res.status(404).json({error:"CV not found."}); res.download(path.join(uploadDir,u.cv_path)); });
app.post("/api/auth/login", async (req,res) => {
  const {email,password} = req.body || {};
  const user = q("SELECT * FROM users WHERE email=?").get(String(email||"").toLowerCase().trim());
  if (!user || !await bcrypt.compare(password || "",user.password_hash)) return res.status(401).json({error:"E-mail ou mot de passe incorrect."});
  res.json({token:sign(user),user:safeUser(user)});
});
app.get("/api/auth/me",auth,(req,res) => {
  const user=q("SELECT * FROM users WHERE id=?").get(req.user.id);
  if(!user) return res.status(401).json({error:"Compte introuvable."});
  res.json({user:safeUser(user)});
});


// Premium plans. Prices are illustrative until a payment provider is configured.
const PREMIUM_PLANS = {
 candidate_premium: { role:"candidate", amount_cents:799, currency:"USD", name:"Candidate Premium" },
 recruiter_premium: { role:"recruiter", amount_cents:2999, currency:"USD", name:"Recruiter Premium" }
};
app.get("/api/plans",(_,res)=>res.json({plans:PREMIUM_PLANS, payment_enabled:false}));
app.post("/api/subscriptions",auth,allow("candidate","recruiter"),(req,res)=>{
 const plan=PREMIUM_PLANS[req.body?.plan];
 if(!plan || plan.role!==req.user.role) return res.status(400).json({error:"This premium plan is not available for your account type."});
 const result=q("INSERT INTO subscriptions(user_id,plan,amount_cents,currency,status) VALUES(?,?,?,?, 'pending_payment')")
  .run(req.user.id,req.body.plan,plan.amount_cents,plan.currency);
 res.status(201).json({subscription_id:result.lastInsertRowid,plan:plan.name,amount_cents:plan.amount_cents,currency:plan.currency,status:"pending_payment",message:"Your subscription request is saved. Online payment is not enabled yet."});
});
app.get("/api/subscriptions/me",auth,(req,res)=>{
 res.json({subscriptions:q("SELECT id,plan,amount_cents,currency,status,created_at FROM subscriptions WHERE user_id=? ORDER BY created_at DESC").all(req.user.id)});
});
// Offres publiées et validées
app.get("/api/jobs",(req,res) => {
  const {q:term,country,type} = req.query;
  let sql="SELECT id,title,company,description,country,city,contract_type,workplace,salary,category,created_at FROM jobs WHERE status='published'";
  const args=[];
  if(country){sql+=" AND country LIKE ?";args.push(`%${country}%`);}
  if(type){sql+=" AND contract_type=?";args.push(type);}
  if(term){sql+=" AND (title LIKE ? OR company LIKE ? OR description LIKE ? OR category LIKE ?)";args.push(...Array(4).fill(`%${term}%`));}
  sql+=" ORDER BY created_at DESC LIMIT 100";
  res.json({jobs:q(sql).all(...args)});
});
app.post("/api/jobs",auth,allow("recruiter","admin"),(req,res) => {
  const {title,company,description,country,city,contract_type,workplace,salary,category}=req.body||{};
  if(!title||!company||!description||!country||!contract_type) return res.status(400).json({error:"Veuillez remplir les champs obligatoires."});
  const r=q("INSERT INTO jobs(recruiter_id,title,company,description,country,city,contract_type,workplace,salary,category,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(req.user.id,title,company,description,country,city||null,contract_type,workplace||"On-site",salary||null,category||null,req.user.role==="admin"?"published":"pending");
  res.status(201).json({id:r.lastInsertRowid,status:req.user.role==="admin"?"published":"pending",message:"Offre enregistrée. Elle sera publiée après validation."});
});
app.get("/api/recruiter/jobs",auth,allow("recruiter","admin"),(req,res)=>{
  const jobs=req.user.role==="admin" ? q("SELECT * FROM jobs ORDER BY created_at DESC").all() : q("SELECT * FROM jobs WHERE recruiter_id=? ORDER BY created_at DESC").all(req.user.id);
  res.json({jobs});
});
app.post("/api/jobs/:id/apply",auth,allow("candidate"),upload.single("cv"),(req,res)=>{
  const job=q("SELECT * FROM jobs WHERE id=? AND status='published'").get(req.params.id);
  if(!job) return res.status(404).json({error:"Offre introuvable."});
  const user=q("SELECT * FROM users WHERE id=?").get(req.user.id);
  const reference="JC-"+new Date().getFullYear()+"-"+crypto.randomBytes(4).toString("hex").toUpperCase();
  q(`INSERT INTO applications(reference,job_id,candidate_id,full_name,email,target_country,profession,contract_type,message,cv_path)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(reference,job.id,user.id,user.name,user.email,job.country,job.title,job.contract_type,`Candidature à l'offre #${job.id}`,req.file?.filename||null);
  res.status(201).json({reference,message:"Candidature enregistrée."});
});

// Demande directe de contrat : référence publique non devinable pour le suivi.
app.post("/api/applications",upload.single("cv"),(req,res)=>{
  const b=req.body||{};
  if(!b.full_name||!b.email||!b.target_country||!b.profession||!b.contract_type)
    return res.status(400).json({error:"Veuillez remplir tous les champs obligatoires."});
  const reference="JC-"+new Date().getFullYear()+"-"+crypto.randomBytes(5).toString("hex").toUpperCase();
  q(`INSERT INTO applications(reference,full_name,email,phone,nationality,residence_country,target_country,profession,contract_type,experience,message,cv_path)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(reference,b.full_name.trim(),b.email.trim().toLowerCase(),b.phone||null,b.nationality||null,b.residence_country||null,b.target_country,b.profession,b.contract_type,b.experience||null,b.message||null,req.file?.filename||null);
  res.status(201).json({reference,message:"Votre demande a bien été reçue. Conservez votre code de référence pour suivre son évolution."});
});
app.get("/api/applications/track/:reference",(req,res)=>{
  const a=q("SELECT reference,full_name,target_country,profession,contract_type,status,admin_note,created_at,updated_at FROM applications WHERE reference=?").get(req.params.reference.toUpperCase());
  if(!a) return res.status(404).json({error:"Aucune demande trouvée pour ce code."});
  res.json({application:a});
});
app.get("/api/candidate/applications",auth,allow("candidate"),(req,res)=>{
  res.json({applications:q("SELECT reference,profession,target_country,contract_type,status,created_at,updated_at FROM applications WHERE candidate_id=? ORDER BY created_at DESC").all(req.user.id)});
});
app.get("/api/recruiter/applications/:reference/cv",auth,allow("recruiter","admin"),(req,res)=>{
  const sql = req.user.role==="admin"
    ? "SELECT a.cv_path FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.reference=?"
    : "SELECT a.cv_path FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.reference=? AND j.recruiter_id=?";
  const row = req.user.role==="admin" ? q(sql).get(req.params.reference) : q(sql).get(req.params.reference,req.user.id);
  if(!row || !row.cv_path) return res.status(404).json({error:"CV introuvable."});
  res.download(path.join(uploadDir,row.cv_path));
});
app.get("/api/recruiter/applications",auth,allow("recruiter","admin"),(req,res)=>{
  const sql = req.user.role==="admin"
    ? "SELECT a.reference,a.full_name,a.email,a.profession,a.target_country,a.status,a.cv_path,j.title AS job_title,j.recruiter_id FROM applications a LEFT JOIN jobs j ON j.id=a.job_id WHERE a.job_id IS NOT NULL ORDER BY a.created_at DESC"
    : "SELECT a.reference,a.full_name,a.email,a.profession,a.target_country,a.status,a.cv_path,j.title AS job_title,j.recruiter_id FROM applications a JOIN jobs j ON j.id=a.job_id WHERE j.recruiter_id=? ORDER BY a.created_at DESC";
  const rows = req.user.role==="admin" ? q(sql).all() : q(sql).all(req.user.id);
  res.json({applications:rows.map(({cv_path,...a})=>({...a,has_cv:!!cv_path}))});
});

// Recruteur : consultation des candidatures à ses offres est prévu via l'ID d'offre.
app.get("/api/admin/overview",auth,allow("admin"),(req,res)=>{
  res.json({
    users:q("SELECT role,COUNT(*) count FROM users GROUP BY role").all(),
    applications:q("SELECT status,COUNT(*) count FROM applications GROUP BY status").all(),
    jobs:q("SELECT status,COUNT(*) count FROM jobs GROUP BY status").all(),
    subscriptions:q("SELECT status,COUNT(*) count FROM subscriptions GROUP BY status").all(),
    latestApplications:q("SELECT reference,full_name,email,profession,target_country,status,created_at FROM applications ORDER BY created_at DESC LIMIT 30").all(),
    latestJobs:q("SELECT id,title,company,country,status,created_at FROM jobs ORDER BY created_at DESC LIMIT 30").all()
  });
});
app.get("/api/admin/subscriptions",auth,allow("admin"),(req,res)=>{
 res.json({subscriptions:q("SELECT s.*,u.name,u.email,u.role FROM subscriptions s JOIN users u ON u.id=s.user_id ORDER BY s.created_at DESC").all()});
});
app.get("/api/admin/applications",auth,allow("admin"),(req,res)=>{
  res.json({applications:q("SELECT * FROM applications ORDER BY created_at DESC").all()});
});
app.patch("/api/admin/applications/:reference",auth,allow("admin"),(req,res)=>{
  const {status,admin_note}=req.body||{};
  const allowed=["received","under_review","shortlisted","approved","rejected","completed"];
  if(!allowed.includes(status)) return res.status(400).json({error:"Statut invalide."});
  const r=q("UPDATE applications SET status=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE reference=?")
    .run(status,admin_note||null,req.params.reference.toUpperCase());
  if(!r.changes) return res.status(404).json({error:"Demande introuvable."});
  res.json({message:"Demande mise à jour."});
});
app.patch("/api/admin/jobs/:id",auth,allow("admin"),(req,res)=>{
  const {status}=req.body||{};
  if(!["pending","published","rejected","closed"].includes(status)) return res.status(400).json({error:"Statut invalide."});
  const r=q("UPDATE jobs SET status=? WHERE id=?").run(status,req.params.id);
  if(!r.changes) return res.status(404).json({error:"Offre introuvable."});
  res.json({message:"Offre mise à jour."});
});
app.get("/api/health",(_,res)=>res.json({status:"ok"}));
app.use((err,req,res,next)=>{
  if(err instanceof multer.MulterError) return res.status(400).json({error:"Fichier trop volumineux ou invalide (5 Mo maximum)."});
  if(err) return res.status(400).json({error:err.message||"Erreur de traitement."});
  next();
});
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`JobConnect disponible sur http://localhost:${PORT}`));
