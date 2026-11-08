const $ = s => document.querySelector(s);
let token = localStorage.getItem("jc_token") || "";
let currentUser = JSON.parse(localStorage.getItem("jc_user") || "null");
const statusLabels = {pending:"Pending",accepted:"Accepted",rejected:"Rejected",received:"Pending",under_review:"Pending",shortlisted:"Accepted",approved:"Accepted",completed:"Accepted"};
function toast(t){const el=$("#toast");el.textContent=t;el.classList.remove("hidden");setTimeout(()=>el.classList.add("hidden"),3500)}
async function api(url,opts={}){const headers={...(opts.headers||{})};if(token)headers.Authorization="Bearer "+token;const res=await fetch(url,{...opts,headers});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||"Une erreur est survenue.");return data}
let pendingPlan="";
function openModal(kind,plan){pendingPlan=plan||"";$("#modal").classList.remove("hidden");$("#modalContent").innerHTML=kind==="login"?`
<h2>Connexion</h2><p class="muted">Access your JobConnect account.</p><form id="authForm"><input name="email" type="email" required placeholder="Email address"><input name="password" type="password" required placeholder="Mot de passe"><button class="btn primary">Se connecter</button></form>`:`
<h2>Créer un compte</h2><p class="muted">Join the international platform.</p><form id="authForm"><input name="name" required placeholder="Full name"><input name="email" type="email" required placeholder="Email address"><input name="password" type="password" minlength="10" required placeholder="Password (at least 10 characters)"><select name="role" id="registerRole"><option value="candidate">Candidate</option><option value="recruiter">Recruiter</option></select><select name="plan" id="registerPlan"><option value="">No premium plan (free account)</option><option value="candidate_premium">Candidate Premium — $7.99/month</option><option value="recruiter_premium">Recruiter Premium — $29.99/month</option></select><label id="cvUploadLabel">Upload your CV (PDF, DOC or DOCX — max 5 MB) *<input name="cv" id="registerCv" type="file" accept=".pdf,.doc,.docx" required></label><input name="company" placeholder="Company (recruiter)"><input name="country" placeholder="Country"><button class="btn primary">Create account</button></form>`;const planSelect=$("#modalContent select[name=plan]");if(kind!=="login"&&planSelect&&pendingPlan)planSelect.value=pendingPlan}
document.querySelectorAll("[data-open]").forEach(b=>b.addEventListener("click",()=>openModal(b.dataset.open)));
$("#closeModal").onclick=()=>$("#modal").classList.add("hidden");
$("#modal").addEventListener("click",e=>{if(e.target.id==="modal")$("#modal").classList.add("hidden")});
$("#modalContent").addEventListener("change",e=>{if(e.target.id==="registerRole"){const cv=$("#registerCv");const label=$("#cvUploadLabel");if(cv){cv.required=e.target.value==="candidate";label.hidden=e.target.value!=="candidate";}}});
$("#modalContent").addEventListener("submit",async e=>{if(e.target.id!=="authForm")return;e.preventDefault();const fd=new FormData(e.target),body=Object.fromEntries(fd.entries());try{const url=body.name?"/api/auth/register":"/api/auth/login";const isRegister=!!body.name;const payload=isRegister?fd:JSON.stringify(body);const headers=isRegister?{}:{"Content-Type":"application/json"};const d=await api(url,{method:"POST",headers,body:payload});token=d.token;currentUser=d.user;localStorage.setItem("jc_token",token);localStorage.setItem("jc_user",JSON.stringify(currentUser));$("#modal").classList.add("hidden");toast("Bienvenue "+currentUser.name+" !");renderDashboard();if(isRegister&&body.plan){api("/api/subscriptions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({plan:body.plan})}).then(r=>toast(r.message)).catch(e=>toast(e.message))}}catch(err){toast(err.message)}});
$("#requestForm").addEventListener("submit",async e=>{e.preventDefault();const btn=e.target.querySelector("button[type=submit]");btn.disabled=true;$("#requestMessage").textContent="Submitting...";try{const d=await api("/api/applications",{method:"POST",body:new FormData(e.target)});$("#referenceResult").innerHTML=`<b>✓ Your request has been submitted!</b><strong>${d.reference}</strong>Keep this code safe. Use it in the Track a request section to check your request status.`;$("#referenceResult").classList.remove("hidden");$("#requestMessage").textContent="";e.target.reset();}catch(err){$("#requestMessage").textContent=err.message}finally{btn.disabled=false}});
$("#trackForm").addEventListener("submit",async e=>{e.preventDefault();const ref=new FormData(e.target).get("reference").trim();const box=$("#trackResult");try{const d=await api("/api/applications/track/"+encodeURIComponent(ref));const a=d.application,sla=d.application.sla||{};box.innerHTML=`<b>Request ${a.reference}</b><p><b>Role:</b> ${escapeHtml(a.profession)} · <b>Country :</b> ${escapeHtml(a.target_country)}</p><p><b>Type :</b> ${escapeHtml(a.contract_type)}</p><p><b>Status :</b> <span class="status status-${a.status}">${statusLabels[a.status]||a.status}</span></p>${a.status==="rejected"&&a.decision_reason?`<p class="reason"><b>Reason:</b> ${escapeHtml(a.decision_reason)}</p>`:""}${a.status==="accepted"&&a.decision_reason?`<p><b>Message:</b> ${escapeHtml(a.decision_reason)}</p>`:""}<p><b>Target response:</b> ${sla.target_min_minutes||5}–${sla.target_max_minutes||20} minutes ${a.status==="pending"?(sla.overdue?`<span class="sla late">in progress (${sla.elapsed_minutes} min)</span>`:`<span class="sla">${sla.remaining_minutes} min left</span>`):`<span class="sla done">answered in ${sla.elapsed_minutes} min</span>`}</p>${a.total_cents?`<p><b>Fee breakdown:</b> JobConnect ${fmtMoney(a.fee_cents,a.currency)} + recruiter ${fmtMoney(a.recruiter_price_cents,a.currency)} = <b>${fmtMoney(a.total_cents,a.currency)}</b>${a.paid_at?" · <span class='status status-accepted'>Paid</span>":" · <span class='status status-pending'>Payment pending</span>"}</p>`:""}<p><b>Last updated:</b> ${new Date(a.updated_at).toLocaleString()}</p>`;box.classList.remove("hidden")}catch(err){box.innerHTML=escapeHtml(err.message);box.classList.remove("hidden")}});
function fmtMoney(c,cur){return "$"+((Number(c||0))/100).toFixed(2)+" "+(cur||"USD")}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
async function loadJobs(){const params=new URLSearchParams();if($("#jobTerm").value)params.set("q",$("#jobTerm").value);if($("#jobCountry").value)params.set("country",$("#jobCountry").value);if($("#jobType").value)params.set("type",$("#jobType").value);const catEl=$("#jobCategory");if(catEl&&catEl.value)params.set("category",catEl.value);try{const d=await api("/api/jobs?"+params);$("#jobs").innerHTML=d.jobs.length?d.jobs.map(j=>`<article class="job"><span class="eyebrow">${escapeHtml(j.contract_type)}</span><h3>${escapeHtml(j.title)}</h3><b>${escapeHtml(j.company)}</b><p>${escapeHtml(j.description.slice(0,160))}${j.description.length>160?"…":""}</p><div class="job-meta">🌍 ${escapeHtml(j.country)} ${j.city?"· "+escapeHtml(j.city):""} · ${escapeHtml(j.workplace||"")}${j.visa_sponsorship?" · ✈️ visa sponsorship":""}</div><div class="job-price"><span>Contract price <b>${fmtMoney((j.pricing||{}).total_cents,j.pricing&&j.pricing.currency)}</b></span><small>JobConnect ${fmtMoney((j.pricing||{}).fee_cents)} + recruiter ${fmtMoney((j.pricing||{}).recruiter_price_cents)}</small></div><button class="btn primary apply" data-id="${j.id}">Apply with resume</button><button class="btn light msg-job" data-job="${j.id}">Message recruiter</button></article>`).join(""):`<p class="muted">No jobs have been posted yet. Please check back soon.</p>`}catch(e){$("#jobs").innerHTML=`<p>${escapeHtml(e.message)}</p>`}}
$("#jobSearch").onclick=loadJobs;
$("#jobs").addEventListener("click",async e=>{const b=e.target.closest(".apply");if(!b)return;if(!token){openModal("login");return}const u=currentUser;if(u?.role!=="candidate"){toast("Log in with a candidate account to apply.");return}const input=document.createElement("input");input.type="file";input.accept=".pdf,.doc,.docx";input.onchange=async()=>{const fd=new FormData();if(input.files[0])fd.append("cv",input.files[0]);try{const d=await api(`/api/jobs/${b.dataset.id}/apply`,{method:"POST",body:fd});toast("Application submitted. Reference: "+d.reference);if(window.JCOpenPayment&&d.pricing){window.JCOpenPayment(d.reference,d.pricing)}}catch(err){toast(err.message)}};input.click()});
async function renderDashboard(){if(!currentUser)return;let old=$("#dashboard");if(old)old.remove();const main=document.querySelector("main");const section=document.createElement("section");section.id="dashboard";section.className="dashboard section";section.innerHTML=`<div class="section-head"><span class="eyebrow">Personal dashboard</span><h2>Hello ${escapeHtml(currentUser.name)}</h2><p>${currentUser.role==="recruiter"?"Manage your job posts":"Your candidate dashboard"}</p></div><div id="dashContent"></div><button class="btn light" id="logout">Log out</button>`;main.prepend(section);$("#logout").onclick=()=>{token="";currentUser=null;localStorage.clear();section.remove();toast("You have logged out.");const l=document.getElementById("jcLauncher");if(l)l.remove()};const box=$("#dashContent");
try{if(currentUser.role==="recruiter"){box.innerHTML=`<form id="jobForm" class="panel form-grid"><h3 class="wide">Post a job</h3><div class="wide" id="subBanner"></div><label>Job title *<input name="title" required></label><label>Company *<input name="company" required value="${escapeHtml(currentUser.company||"")}"></label><label>Country *<input name="country" required></label><label>City<input name="city"></label><label>Contract type *<select name="contract_type"><option>Permanent</option><option>Fixed-term</option><option>Temporary</option><option>Internship</option><option>Freelance</option></select></label><label>Work arrangement<select name="workplace"><option>On-site</option><option>Remote</option><option>Hybrid</option></select></label><label>Salary<input name="salary"></label><label>Category<select name="category"><option value="">Select a category</option></select></label><label>Your price per contract (USD)<input name="recruiter_price_cents" type="number" min="0" step="100" placeholder="15000" title="Amount in cents"></label><label>Open positions<input name="positions" type="number" min="1" value="1"></label><label>Visa sponsorship<select name="visa_sponsorship"><option value="">No</option><option value="true">Yes</option></select></label><label class="wide">Description *<textarea name="description" required rows="4"></textarea></label><button class="btn primary wide">Submit job</button></form><div id="recruiterJobs"></div>`;$("#jobForm").onsubmit=async e=>{e.preventDefault();try{const d=Object.fromEntries(new FormData(e.target));if(d.recruiter_price_cents)d.recruiter_price_cents=Math.round(Number(d.recruiter_price_cents));if(d.positions)d.positions=Number(d.positions);d.visa_sponsorship=d.visa_sponsorship==="true";const r=await api("/api/jobs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)});toast(r.message);e.target.reset()}catch(err){toast(err.message)}};const sub=await api("/api/subscriptions/me").catch(()=>({subscriptions:[]}));const active=(sub.subscriptions||[]).filter(x=>x.status==="active")[0];const banner=$("#subBanner");if(banner){banner.innerHTML=active?`<div class="sub-ok">✓ Subscription active — ${escapeHtml(active.plan)} until ${new Date(active.current_period_end||active.created_at).toLocaleDateString()}</div>`:`<div class="sub-required"><b>Subscription required.</b> Recruiters must hold Recruiter Pro ($95/month) or the promotional plan before publishing. <button class="btn primary" id="subNow">Subscribe now</button></div>`;const sb=$("#subNow");if(sb)sb.onclick=async()=>{try{const r=await api("/api/subscriptions/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({plan:"recruiter_pro"})});if(r.checkout_url)window.location.href=r.checkout_url}catch(e){toast(e.message)}}}const d=await api("/api/recruiter/jobs");const a=await api("/api/recruiter/applications");$("#recruiterJobs").addEventListener("click",async e=>{const link=e.target.closest(".cv-download");if(!link)return;e.preventDefault();try{const r=await fetch("/api/recruiter/applications/"+encodeURIComponent(link.dataset.ref)+"/cv",{headers:{Authorization:"Bearer "+token}});if(!r.ok)throw new Error("Could not download the resume.");const blob=await r.blob();const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="Resume-"+link.dataset.ref;a.click();URL.revokeObjectURL(url)}catch(err){toast(err.message)}});$("#recruiterJobs").innerHTML="<h3>Your jobs</h3>"+d.jobs.map(j=>`<p>${escapeHtml(j.title)} — ${escapeHtml(j.country)} · <b>${escapeHtml(j.status)}</b></p>`).join("")+"<h3>Applications received</h3>"+(a.applications.length?a.applications.map(x=>`<div class="metric"><b>${escapeHtml(x.full_name)}</b>${escapeHtml(x.job_title||x.profession)} · ${escapeHtml(x.email)}<p>${escapeHtml(x.target_country)} · <span class="status status-${x.status}">${statusLabels[x.status]||x.status}</span>${x.has_cv?` · <a href="#" class="cv-download" data-ref="${x.reference}">Download resume</a>`:" · No resume attached"}</p>${x.status==="pending"?`<button class="btn primary decide" data-ref="${x.reference}" data-status="accepted">Accept</button> <button class="btn light decide" data-ref="${x.reference}" data-status="rejected">Reject</button>`:""}</div>`).join(""):"<p>No applications received yet.</p>")}
else{const d=await api("/api/candidate/applications");const pay=await api("/api/payments/mine").catch(()=>({payments:[]}));const paidByRef={};(pay.payments||[]).forEach(p=>{paidByRef[p.reference]=p});box.innerHTML="<h3>My requests and applications</h3>"+(d.applications.length?d.applications.map(a=>`<div class="metric"><b>${a.reference}</b>${escapeHtml(a.profession)} · ${escapeHtml(a.target_country)}<p><span class="status status-${a.status}">${statusLabels[a.status]||a.status}</span>${a.decision_reason?" · "+escapeHtml(a.decision_reason):""}</p><p>${a.total_cents?`JobConnect ${fmtMoney(a.fee_cents,a.currency)} + recruiter ${fmtMoney(a.recruiter_price_cents,a.currency)} = <b>${fmtMoney(a.total_cents,a.currency)}</b>`:""}</p>${a.status==="pending"&&a.total_cents?`<button class="btn primary pay-now" data-ref="${a.reference}" data-fee="${a.fee_cents||0}" data-recruiter="${a.recruiter_price_cents||0}" data-total="${a.total_cents||0}" data-currency="${a.currency||"USD"}">Pay now</button>`:""}</div>`).join(""):"<p>You do not have any requests linked to this account yet.</p>")+(pay.payments||[]).length?"<h3>Payments</h3>"+(pay.payments||[]).map(p=>`<div class="metric"><b>${escapeHtml(p.reference)}</b>${fmtMoney(p.total_cents,p.currency)} · ${escapeHtml(p.status)}<p>${p.status==="paid"?`<a class="btn light" href="/api/payments/${encodeURIComponent(p.reference)}/receipt.pdf">Download receipt</a> · ${escapeHtml(p.receipt_number||"")}`:"Awaiting confirmation"}</p></div>`).join(""):""}}
catch(err){box.innerHTML=`<p>${escapeHtml(err.message)}</p>`}if(window.JCRefreshChatWidget)window.JCRefreshChatWidget();if(window.JCFillCatalogs)window.JCFillCatalogs()}
document.addEventListener("click",async e=>{const b=e.target.closest(".decide");if(!b)return;e.preventDefault();
const status=b.dataset.status;let reason="";
if(status==="rejected"){reason=prompt("Reason for rejection (required, visible to the candidate):","");if(reason===null)return;if(reason.trim().length<5){toast("A reason of at least 5 characters is required.");return}}
else{const note=prompt("Optional message for the candidate:","");if(note!==null)reason=note}
try{await api("/api/recruiter/applications/"+encodeURIComponent(b.dataset.ref)+"/decision",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status,decision_reason:reason})});toast("Decision recorded.");renderDashboard()}catch(err){toast(err.message)}});
document.querySelectorAll(".choose-plan").forEach(b=>b.addEventListener("click",async()=>{const plan=b.dataset.plan;
if(!token){openModal("register",plan);const roleEl=$("#modalContent select[name=role]");if(roleEl){roleEl.value="recruiter";roleEl.dispatchEvent(new Event("change",{bubbles:true}))}return}
if(currentUser.role!=="recruiter"){toast("Recruiter plans are only available to recruiter accounts.");return}
try{const d=await api("/api/subscriptions/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({plan})});
if(d.checkout_url){window.location.href=d.checkout_url}else{toast(d.message||"Subscription started.")}}catch(err){toast(err.message)}}));
$("#hamb").onclick=()=>document.querySelector(".top nav").classList.toggle("open");
loadJobs();
if(token&&currentUser)renderDashboard();

/* ---------- thème clair / sombre ---------- */
(function(){
  var root=document.documentElement;
  var btn=document.getElementById("themeToggle");
  function paint(){
    var dark=root.getAttribute("data-theme")==="dark";
    if(btn)btn.textContent=dark?"☀️":"🌙";
  }
  if(btn)btn.addEventListener("click",function(){
    var next=root.getAttribute("data-theme")==="dark"?"light":"dark";
    root.setAttribute("data-theme",next);
    try{localStorage.setItem("jc_theme",next)}catch(e){}
    paint();
  });
  paint();
})();

/* ---------- ombre de l'en-tête au défilement ---------- */
(function(){
  var top=document.querySelector(".top");
  if(!top)return;
  var onScroll=function(){top.classList.toggle("scrolled",window.scrollY>8)};
  window.addEventListener("scroll",onScroll,{passive:true});onScroll();
})();

/* ---------- apparition des blocs au défilement ---------- */
(function(){
  var sel=".section, .job, .plan, .stats, .panel, .track-result";
  function prepare(){
    var nodes=document.querySelectorAll(sel);
    if(!("IntersectionObserver" in window)){return;}
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if(en.isIntersecting){en.target.classList.add("in");io.unobserve(en.target);}
      });
    },{rootMargin:"0px 0px -8% 0px",threshold:.08});
    nodes.forEach(function(n){
      if(n.closest(".dashboard"))return;
      n.classList.add("reveal");
      io.observe(n);
    });
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",prepare);
  else prepare();
})();

/* ---------- filtre catégorie sur la recherche d'offres ---------- */
(function(){
  var btn=document.getElementById("jobSearch");
  if(!btn)return;
  btn.addEventListener("click",function(){
    var cat=document.getElementById("jobCategory");
    if(cat)window.__jcCategory=cat.value;
  });
})();
