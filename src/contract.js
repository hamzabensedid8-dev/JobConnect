/* ==========================================================================
   JobConnect — contenu et mise en page du contrat (PDF)
   Le document est rédigé en anglais, comme le reste de la plateforme.
   ========================================================================== */

import { createDocument, wrapText } from './pdf.js';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function contractMoney(cents, currency = 'USD') {
  const value = Number(cents || 0) / 100;
  return `${currency} ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function contractDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function orText(value, fallback = '—') {
  const text = value == null ? '' : String(value).trim();
  return text || fallback;
}

/**
 * Construit le PDF d'un contrat.
 * @param {object} contract  enregistrement `contracts`
 * @param {{bytes:Uint8Array,width:number,height:number}|null} logo
 */
export function buildContractPdf(contract, logo) {
  const c = contract;
  const free = Boolean(c.is_free) || Number(c.total_cents || 0) === 0;

  const doc = createDocument({
    logo,
    title: 'Employment contract',
    subtitle: `${orText(c.contract_number, 'Draft')} · Issued by JobConnect`,
    footer: `JobConnect · contract ${orText(c.contract_number, 'draft')} · jc.jobconnectdz.workers.dev`
  });

  /* ---------------------------------------------------------- parties --- */
  doc.heading('1. Parties to the contract');
  doc.field('Employer', orText(c.employer_name));
  if (c.employer_address) doc.field('Employer address', c.employer_address);
  if (c.employer_contact) doc.field('Employer contact', c.employer_contact);
  doc.field('Employee', orText(c.employee_name));
  if (c.employee_address) doc.field('Employee address', c.employee_address);
  if (c.employee_passport) doc.field('Passport / ID', c.employee_passport);
  if (c.employee_nationality) doc.field('Nationality', c.employee_nationality);
  if (c.employee_contact) doc.field('Employee contact', c.employee_contact);
  if (c.employee_birth_date) doc.field('Date of birth', contractDate(c.employee_birth_date));

  /* ----------------------------------------------------------- object --- */
  doc.heading('2. Position and place of work');
  doc.field('Position', orText(c.position));
  doc.field('Contract type', orText(c.contract_type, 'Permanent'));
  doc.field('Country', orText(c.country));
  if (c.city) doc.field('City', c.city);
  if (c.duration_months) doc.field('Duration', `${c.duration_months} month(s)`);
  doc.field('Start date', contractDate(c.start_date));
  if (c.end_date) doc.field('End date', contractDate(c.end_date));
  if (c.weekly_hours) doc.field('Working time', `${c.weekly_hours} hours per week`);
  if (c.trial_period) doc.field('Trial period', c.trial_period);

  /* ----------------------------------------------------- remuneration --- */
  doc.heading('3. Remuneration and benefits');
  if (c.salary) doc.field('Gross salary', c.salary);
  if (c.salary_period) doc.field('Payment period', c.salary_period);
  if (c.benefits) doc.field('Benefits', c.benefits);
  if (c.housing) doc.field('Accommodation', c.housing);
  if (c.transport) doc.field('Transport', c.transport);

  doc.paragraph(
    'Salary is paid by the employer on the agreed payment period, net of the deductions required by the ' +
      'law of the country of employment. Overtime, public holidays, paid leave and sickness are governed ' +
      'by the labour code applicable at the place of work.',
    { size: 10, spaceAfter: 8 }
  );

  /* ------------------------------------------------------- service fee --- */
  doc.heading('4. JobConnect service fee');
  if (free) {
    doc.paragraph(
      'This placement is processed free of charge for the employee. JobConnect does not charge the ' +
        'candidate any application, placement or processing fee for this contract: all recruitment costs ' +
        'are borne by the employer.',
      { size: 10, spaceAfter: 8 }
    );
  } else {
    doc.paragraph(
      'The employee pays the JobConnect service fee stated below, which covers the verification of the ' +
        'employer, the preparation of this contract and the follow-up of the file until signature. The fee ' +
        'is due once, is never recurring, and is charged in the currency shown.',
      { size: 10, spaceAfter: 8 }
    );
  }
  doc.box(free ? 'No fee for the employee' : 'Amount due by the employee', [
    free
      ? 'Total to pay by the employee: 0.00 (free placement).'
      : `Total to pay: ${contractMoney(c.total_cents, c.currency || 'USD')}`,
    ...(free
      ? []
      : [
          `JobConnect fee: ${contractMoney(c.fee_cents, c.currency || 'USD')}`,
          `Recruiter price: ${contractMoney(c.recruiter_price_cents, c.currency || 'USD')}`,
          c.payment_reference ? `Payment reference: ${c.payment_reference}` : 'Payment status: pending',
          'Card payments are handled by our payment provider. Card data is never stored by JobConnect.'
        ])
  ]);

  /* ------------------------------------------------------- obligations --- */
  doc.heading('5. Obligations of the employer');
  const employerDuties = [
    'Provide the employee with lawful work, the agreed working conditions and the equipment required to perform the duties.',
    'Comply with the labour law, social security and tax obligations of the country of employment, including work permit and residence permit formalities.',
    'Pay the agreed salary on time and issue payslips, a certificate of employment and any other document required by law.',
    'Ensure health and safety at work and subscribe to the mandatory insurance cover.',
    'Never request any payment from the employee other than those expressly stated in this contract.'
  ];
  employerDuties.forEach((item, index) => {
    doc.paragraph(`${index + 1}. ${item}`, { size: 10, indent: 8, spaceAfter: 2 });
  });

  doc.heading('6. Obligations of the employee');
  const employeeDuties = [
    'Perform the duties with care, loyalty and professional diligence, and follow the lawful instructions of the employer.',
    'Hold valid travel documents and provide genuine diplomas, certificates and references.',
    'Respect the internal rules of the company, confidentiality and the laws of the country of employment.',
    'Inform the employer and JobConnect immediately of any change affecting the ability to take up the position.',
    'Never pay any intermediary other than the amounts stated in this contract.'
  ];
  employeeDuties.forEach((item, index) => {
    doc.paragraph(`${index + 1}. ${item}`, { size: 10, indent: 8, spaceAfter: 2 });
  });

  /* ------------------------------------------------------- conditions --- */
  doc.heading('7. Term, termination and dispute resolution');
  doc.paragraph(
    'This contract takes effect on the start date stated above. Before that date, either party may terminate it ' +
      'in writing. During the contract, termination and the notice period follow the labour code of the country ' +
      'of employment and, where applicable, the collective agreement of the sector.',
    { size: 10 }
  );
  doc.paragraph(
    'In the event of a dispute, the parties first seek an amicable solution with the help of JobConnect. Failing ' +
      'agreement within thirty (30) days, the dispute is submitted to the competent courts of the place of work. ' +
      'This contract is governed by the law of the country of employment.',
    { size: 10 }
  );

  if (c.additional_clauses) {
    doc.heading('8. Additional clauses');
    doc.paragraph(c.additional_clauses, { size: 10 });
  }

  /* --------------------------------------------------------- signatures --- */
  const sectionNumber = c.additional_clauses ? 9 : 8;
  doc.heading(`${sectionNumber}. Signatures`);
  doc.paragraph(
    'The parties declare that they have read and understood this contract and sign it in two original copies, ' +
      'one for each party.',
    { size: 10, spaceAfter: 10 }
  );
  doc.field('Signed at', orText(c.signing_place, orText(c.city, '—')));
  doc.field('Date', contractDate(c.signing_date || new Date().toISOString()));
  doc.signatureBlock('For the employer', 'For the employee');

  doc.paragraph(
    `Document generated by JobConnect on ${contractDate(new Date().toISOString())}. Reference: ${orText(c.contract_number, 'draft')}.`,
    { font: 'serif', size: 8.5, spaceAfter: 2 }
  );

  return doc.toBytes();
}

/** Petit utilitaire : largeur/hauteur d'un JPEG (pour l'image du logo). */
export function jpegSize(bytes) {
  let i = 2;
  while (i < bytes.length - 9) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      return { width, height };
    }
    i += 2 + length;
  }
  return { width: 544, height: 256 };
}

export { contractMoney as formatMoney, contractDate as longDate };
