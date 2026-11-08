/* ==========================================================================
   JobConnect — catalogues (catégories, nationalités, pays, contrats)
   Utilisés pour les menus déroulants et les champs à saisie assistée.
   ========================================================================== */
(function () {
  var CATEGORIES = [
    "Healthcare & Nursing", "Information Technology", "Engineering", "Construction & Trades",
    "Skilled Trades & Manufacturing", "Logistics & Transport", "Hospitality & Tourism",
    "Food & Catering", "Agriculture & Farming", "Education & Training", "Finance & Accounting",
    "Sales & Retail", "Marketing & Communication", "Customer Support", "Administration & Office",
    "Legal", "Human Resources", "Social Work & Care", "Pharmacy & Laboratory", "Automotive",
    "Aviation", "Maritime & Offshore", "Energy & Utilities", "Mining & Resources",
    "Oil & Gas", "Textile & Garment", "Beauty & Wellness", "Sports & Fitness",
    "Security & Safety", "Cleaning & Facility", "Domestic & Household Work",
    "Childcare & Nanny", "Elderly Care", "Dentistry", "Veterinary", "Media & Creative",
    "Design & Architecture", "Real Estate", "Public Sector", "Research & Science",
    "Telecommunications", "Warehouse & Storage", "Driving & Delivery"
  ];

  var COUNTRIES = [
    "Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda","Argentina","Armenia","Australia","Austria",
    "Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan",
    "Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso","Burundi","Cambodia","Cameroon",
    "Canada","Cape Verde","Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo","Costa Rica",
    "Croatia","Cuba","Cyprus","Czechia","Denmark","Djibouti","Dominica","Dominican Republic","DR Congo","Ecuador",
    "Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland","France",
    "Gabon","Gambia","Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea","Guinea-Bissau",
    "Guyana","Haiti","Honduras","Hong Kong","Hungary","Iceland","India","Indonesia","Iran","Iraq",
    "Ireland","Israel","Italy","Ivory Coast","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati",
    "Kosovo","Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein",
    "Lithuania","Luxembourg","Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Marshall Islands","Mauritania",
    "Mauritius","Mexico","Micronesia","Moldova","Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar",
    "Namibia","Nauru","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Macedonia","Norway",
    "Oman","Pakistan","Palau","Palestine","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland",
    "Portugal","Qatar","Romania","Russia","Rwanda","Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines","Samoa","San Marino",
    "Sao Tome and Principe","Saudi Arabia","Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands",
    "Somalia","South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland",
    "Syria","Taiwan","Tajikistan","Tanzania","Thailand","Timor-Leste","Togo","Tonga","Trinidad and Tobago","Tunisia",
    "Turkey","Turkmenistan","Tuvalu","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan",
    "Vanuatu","Vatican City","Venezuela","Vietnam","Yemen","Zambia","Zimbabwe"
  ];

  var NATIONALITIES = [
    "Afghan","Albanian","Algerian","Andorran","Angolan","Antiguan","Argentine","Armenian","Australian","Austrian",
    "Azerbaijani","Bahamian","Bahraini","Bangladeshi","Barbadian","Belarusian","Belgian","Belizean","Beninese","Bhutanese",
    "Bolivian","Bosnian","Botswanan","Brazilian","Bruneian","Bulgarian","Burkinabe","Burundian","Cambodian","Cameroonian",
    "Canadian","Cape Verdean","Central African","Chadian","Chilean","Chinese","Colombian","Comorian","Congolese","Costa Rican",
    "Croatian","Cuban","Cypriot","Czech","Danish","Djiboutian","Dominican","Dutch","Ecuadorian","Egyptian",
    "Emirati","English","Equatorial Guinean","Eritrean","Estonian","Eswatini","Ethiopian","Fijian","Filipino","Finnish",
    "French","Gabonese","Gambian","Georgian","German","Ghanaian","Greek","Grenadian","Guatemalan","Guinean",
    "Guyanese","Haitian","Honduran","Hungarian","Icelandic","Indian","Indonesian","Iranian","Iraqi","Irish",
    "Israeli","Italian","Ivorian","Jamaican","Japanese","Jordanian","Kazakh","Kenyan","Kittitian","Kuwaiti",
    "Kyrgyz","Laotian","Latvian","Lebanese","Liberian","Libyan","Liechtenstein","Lithuanian","Luxembourgish","Macedonian",
    "Malagasy","Malawian","Malaysian","Maldivian","Malian","Maltese","Mauritanian","Mauritian","Mexican","Moldovan",
    "Monacan","Mongolian","Montenegrin","Moroccan","Mozambican","Namibian","Nepalese","New Zealander","Nicaraguan","Nigerien",
    "Nigerian","North Korean","Norwegian","Omani","Pakistani","Palauan","Palestinian","Panamanian","Papua New Guinean","Paraguayan",
    "Peruvian","Polish","Portuguese","Qatari","Romanian","Russian","Rwandan","Samoan","Saudi","Scottish",
    "Senegalese","Serbian","Seychellois","Sierra Leonean","Singaporean","Slovak","Slovenian","Somali","South African","South Korean",
    "Spanish","Sri Lankan","Sudanese","Surinamese","Swedish","Swiss","Syrian","Taiwanese","Tajik","Tanzanian",
    "Thai","Togolese","Tongan","Trinidadian","Tunisian","Turkish","Turkmen","Tuvaluan","Ugandan","Ukrainian",
    "Uruguayan","Uzbek","Vanuatuan","Venezuelan","Vietnamese","Welsh","Yemeni","Zambian","Zimbabwean"
  ];

  var CONTRACT_TYPES = ["Permanent", "Fixed-term", "Temporary", "Seasonal", "Internship", "Language stay", "Apprenticeship", "Freelance"];

  // Professions rattachées à chaque catégorie (menu repliable « tout par catégorie »).
  var PROFESSIONS_BY_CATEGORY = {
    "Healthcare & Nursing": ["Nurse", "Caregiver", "Midwife", "Physiotherapist", "Radiology Technician"],
    "Information Technology": ["Software Developer", "Data Analyst", "Network Technician", "Cybersecurity Analyst", "Support Technician"],
    "Engineering": ["Civil Engineer", "Mechanical Engineer", "Electrical Engineer", "Site Engineer"],
    "Construction & Trades": ["Mason", "Carpenter", "Electrician", "Plumber", "Welder", "Scaffolder"],
    "Skilled Trades & Manufacturing": ["Machine Operator", "Quality Controller", "Assembly Worker", "CNC Operator"],
    "Logistics & Transport": ["Warehouse Worker", "Forklift Operator", "Truck Driver", "Dispatcher"],
    "Hospitality & Tourism": ["Hotel Receptionist", "Waiter", "Housekeeper", "Tour Guide"],
    "Food & Catering": ["Chef", "Pastry Chef", "Kitchen Assistant", "Barista"],
    "Agriculture & Farming": ["Farm Worker", "Greenhouse Worker", "Livestock Handler"],
    "Education & Training": ["Teacher", "Teaching Assistant", "Language Trainer", "Childcare Worker"],
    "Finance & Accounting": ["Accountant", "Bookkeeper", "Financial Analyst", "Payroll Officer"],
    "Sales & Retail": ["Sales Representative", "Store Manager", "Cashier"],
    "Marketing & Communication": ["Marketing Officer", "Content Creator", "Community Manager"],
    "Customer Support": ["Customer Service Agent", "Call Centre Agent", "Helpdesk Agent"],
    "Administration & Office": ["Administrative Assistant", "Secretary", "Data Entry Clerk"],
    "Legal": ["Legal Assistant", "Paralegal", "Compliance Officer"],
    "Human Resources": ["HR Officer", "Recruiter", "Training Coordinator"],
    "Social Work & Care": ["Social Worker", "Elderly Care Assistant", "Disability Support Worker"],
    "Pharmacy & Laboratory": ["Pharmacist", "Pharmacy Assistant", "Laboratory Technician"],
    "Automotive": ["Mechanic", "Auto Electrician", "Bodywork Technician"],
    "Aviation": ["Cabin Crew", "Ground Handler", "Aircraft Technician"],
    "Maritime & Offshore": ["Deckhand", "Marine Engineer", "Offshore Technician"],
    "Energy & Utilities": ["Solar Installer", "Wind Turbine Technician", "Power Plant Operator"],
    "Mining & Resources": ["Mine Operator", "Geologist", "Heavy Equipment Operator"],
    "Oil & Gas": ["Pipeline Technician", "Drilling Assistant", "HSE Officer"],
    "Textile & Garment": ["Tailor", "Machine Sewer", "Pattern Maker"],
    "Beauty & Wellness": ["Hairdresser", "Beautician", "Massage Therapist"],
    "Sports & Fitness": ["Fitness Coach", "Sports Instructor", "Lifeguard"],
    "Security & Safety": ["Security Guard", "Safety Officer", "Fire Safety Technician"],
    "Cleaning & Facility": ["Cleaner", "Facility Manager", "Window Cleaner"],
    "Domestic & Household Work": ["Housekeeper", "Nanny", "Home Carer"],
    "Childcare & Nanny": ["Nanny", "Au Pair", "Kindergarten Assistant"],
    "Elderly Care": ["Elderly Care Assistant", "Live-in Carer", "Nursing Home Aide"],
    "Dentistry": ["Dental Assistant", "Dental Hygienist", "Dentist"],
    "Veterinary": ["Veterinary Assistant", "Animal Care Worker"],
    "Media & Creative": ["Video Editor", "Photographer", "Graphic Designer"],
    "Design & Architecture": ["Architect", "Draughtsman", "Interior Designer"],
    "Real Estate": ["Property Agent", "Property Manager"],
    "Public Sector": ["Administrative Officer", "Municipal Agent"],
    "Research & Science": ["Research Assistant", "Lab Scientist"],
    "Telecommunications": ["Fibre Technician", "Network Installer"],
    "Warehouse & Storage": ["Storekeeper", "Inventory Clerk", "Picker Packer"],
    "Driving & Delivery": ["Delivery Driver", "Bus Driver", "Courier"]
  };
  var EXPERIENCE_LEVELS = ["Entry level", "Less than 2 years", "2–5 years", "5–10 years", "More than 10 years"];

  window.JC_CATALOG = {
    categories: CATEGORIES,
    professionsByCategory: PROFESSIONS_BY_CATEGORY,
    countries: COUNTRIES,
    nationalities: NATIONALITIES,
    contractTypes: CONTRACT_TYPES,
    experienceLevels: EXPERIENCE_LEVELS
  };

  function fillDatalist(id, values) {
    var dl = document.getElementById(id);
    if (!dl) return;
    dl.innerHTML = values.map(function (v) {
      return '<option value="' + String(v).replace(/"/g, "&quot;") + '"></option>';
    }).join("");
  }

  function fillSelect(select, values, placeholder) {
    if (!select) return;
    var current = select.value;
    select.innerHTML =
      (placeholder ? '<option value="">' + placeholder + "</option>" : "") +
      values.map(function (v) { return "<option>" + v + "</option>"; }).join("");
    if (current) select.value = current;
  }


  // Le tableau de bord recruteur est construit après coup : on l'alimente aussi.
  window.JCFillCatalogs = function () {
    fillSelect(document.getElementById("professionCategory"), CATEGORIES, "Select a category");
    fillSelect(document.getElementById("jobCategory"), CATEGORIES, "All categories");
    Array.prototype.forEach.call(document.querySelectorAll('select[name="category"]'), function (sel) {
      if (sel.options.length <= 1) fillSelect(sel, CATEGORIES, "Select a category");
    });
    Array.prototype.forEach.call(document.querySelectorAll('select[name="nationality"]'), function (sel) {
      if (sel.options.length <= 1) fillSelect(sel, NATIONALITIES, "Select your nationality");
    });
    Array.prototype.forEach.call(document.querySelectorAll('select[name="residence_country"], select[name="target_country"]'), function (sel) {
      if (sel.options.length <= 1) fillSelect(sel, COUNTRIES, "Select a country");
    });
  };

  document.addEventListener("DOMContentLoaded", function () {
    fillDatalist("countriesList", COUNTRIES);
    fillDatalist("nationalitiesList", NATIONALITIES);
    fillDatalist("professionsList", [
      "Nurse","Doctor","Caregiver","Pharmacist","Physiotherapist","Software Developer","Data Analyst",
      "Network Technician","Civil Engineer","Mechanical Engineer","Electrician","Plumber","Welder",
      "Carpenter","Mason","Heavy Machine Operator","Truck Driver","Forklift Operator","Warehouse Worker",
      "Chef","Waiter","Hotel Receptionist","Housekeeper","Cleaner","Security Guard","Farm Worker",
      "Teacher","Accountant","Sales Representative","Customer Service Agent","Administrative Assistant",
      "Mechanic","Hairdresser","Beautician","Childcare Worker","Delivery Driver","Tailor"
    ]);
    fillSelect(document.getElementById("professionCategory"), CATEGORIES, "Select a category");
    fillSelect(document.getElementById("jobCategory"), CATEGORIES, "All categories");

    // Pays / nationalités : catalogues complets dans les formulaires
    Array.prototype.forEach.call(document.querySelectorAll('select[name="nationality"]'), function (sel) {
      fillSelect(sel, NATIONALITIES, "Select your nationality");
    });
    Array.prototype.forEach.call(document.querySelectorAll('select[name="residence_country"]'), function (sel) {
      fillSelect(sel, COUNTRIES, "Select your country");
    });
    Array.prototype.forEach.call(document.querySelectorAll('select[name="target_country"]'), function (sel) {
      fillSelect(sel, COUNTRIES, "Select a destination");
    });
  });
})();
