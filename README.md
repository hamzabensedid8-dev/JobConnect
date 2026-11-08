# JobConnect — International recruitment platform (MVP v2)

English-language MVP for international work-contract requests and recruitment.

## Included
- English public website and international request form.
- Unique reference code for each direct contract request and public tracking.
- Candidate and recruiter accounts with role-based access.
- Recruiter job posting, admin moderation, and recruiter application inbox.
- Resume upload (PDF, DOC, DOCX; 5 MB maximum) and authorized CV downloads.
- Candidate application history and admin dashboard.
- SQLite database for users, jobs, applications, and premium subscription requests.
- Candidate Premium: proposed price $7.99 USD/month.
- Recruiter Premium: proposed price $29.99 USD/month.
- Subscription requests are stored as `pending_payment`.

## Run locally
Requirements: Node.js 20+ and npm.
1. Extract the ZIP and open a terminal in the project directory.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set a random `JWT_SECRET` of at least 32 characters and change the initial admin password.
5. Run `npm start`.
6. Visit http://localhost:3000.

## Payment limitation
No payment processor is connected. Prices are proposed examples, not live offers. The API records subscription intents as `pending_payment`; it does not charge cards or activate paid access. Before launch, integrate a provider available in the target markets, verify webhooks server-side, and implement renewals, cancellations and refunds. Never collect card details directly in this app.

## Production checklist
- Deploy behind HTTPS and use a managed production database such as PostgreSQL.
- Set `CORS_ORIGIN` to the exact production domain.
- Store resumes in private object storage, scan uploads for malware, and enforce retention/deletion policies.
- Add email verification, password reset, MFA for admins, audit logs, anti-spam controls and transactional email.
- This version's interface is English only.
- Obtain legal review for privacy, subscriptions, auto-renewal, tax and recruitment rules in every market served.
- Replace sample listings with real, verified jobs. JobConnect does not guarantee visas, offers or employment.

### Candidate CV at registration
Candidate registration now requires a local CV upload (PDF, DOC or DOCX, maximum 5 MB). The file is stored in the private uploads directory and linked to the candidate account. Recruiter accounts do not require a CV. Administrators can retrieve a candidate profile CV through the authenticated endpoint `GET /api/admin/users/:id/cv`.
