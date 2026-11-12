// THE PROJECTIONS FOLDER, IMPORTED (Jon, 2026-11-12: "build this into the rental projections library,
// allow us in the library to modify these projections, but here is a start"). Every projection in
// "Stay Rental Projections by Building and Unit Type (Nov 12, 2026)": its building, unit type, units,
// annual gross range, nightly rate, occupancy, who it was prepared for, the notes and a link to its PDF
// on Drive. Identical ranges in one building are one unit type with all their units.
//
// Left out on purpose: The Rider (already in the library), the Icon 2510 "four scenarios" file (internal
// only: it carries an owner's private statement figures), and the NoMad 718 and Crosby 1814 / 1613
// projections, which are not in the folder.
// Flags: Icon and NoMad are not approved by Ryan yet ('pending'); Hyde T4003 sits above the PriceLabs top
// estimate, 29 Indian Creek carries the 30-day-minimum caveat, CIRC 703 is a 30-day projection and
// Beachwalk is a PriceLabs estimate, not a Stay projection ('caveat'). None of those feed the public
// projections calculator until someone switches them on in the library.
//
// Seeded into the library once (lib/sales-library: each id is remembered, so an entry deleted later
// does not come back); from then on every figure is edited in the library like any other entry.
export type SeedPlan = { id: string; type: string; units: string[]; lo: number; hi: number; adr: number[]; occ: number[]; preparedFor: string[]; notes: string[]; files: { name: string; url: string }[]; prepared: string; status: 'approved' | 'pending' | 'caveat'; public: boolean }
export type SeedBuilding = { id: string; name: string; area: string; plans: SeedPlan[] }
export const PROJECTIONS_SEED_2026_11_12: SeedBuilding[] = [
 {
  "id": "imp-e11even",
  "name": "E11EVEN",
  "area": "Downtown Miami",
  "plans": [
   {
    "id": "e11even-studio-0",
    "type": "Studio",
    "units": [
     "3105"
    ],
    "lo": 55400,
    "hi": 64800,
    "adr": [
     220,
     240
    ],
    "occ": [
     69,
     74
    ],
    "preparedFor": [
     "Dhruv Boinapally"
    ],
    "notes": [
     "Owner is signed; onboarding."
    ],
    "files": [
     {
      "name": "Studio - E11EVEN 3105.pdf",
      "url": "https://drive.google.com/file/d/1j4_cmulqV5kfBwQa5kXHiR70LWo07UlK/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "approved",
    "public": true
   },
   {
    "id": "e11even-1br-1",
    "type": "1BR",
    "units": [
     "2905"
    ],
    "lo": 65000,
    "hi": 78000,
    "adr": [
     270,
     288
    ],
    "occ": [
     66,
     74
    ],
    "preparedFor": [
     "Scott Porter"
    ],
    "notes": [],
    "files": [
     {
      "name": "1BR - E11EVEN 2905.pdf",
      "url": "https://drive.google.com/file/d/1qTW8ZA2cfBVCL2Jr6yYN5YmcViBEXEmv/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "approved",
    "public": true
   },
   {
    "id": "e11even-2br-2",
    "type": "2BR",
    "units": [
     "3706",
     "4310",
     "4601"
    ],
    "lo": 98000,
    "hi": 123000,
    "adr": [
     407,
     455
    ],
    "occ": [
     66,
     74
    ],
    "preparedFor": [
     "Jason",
     "Frank Cassidy",
     "Frano Milicevic"
    ],
    "notes": [
     "Unit is listed for sale; sent as income while it sits on the market.",
     "Same E11EVEN 2BR basis as 3706 and 4601.",
     "Same E11EVEN 2BR basis as 3706 and 4310."
    ],
    "files": [
     {
      "name": "2BR - E11EVEN 3706.pdf",
      "url": "https://drive.google.com/file/d/18fwwMi9Et2vCFSFaZLHq2_f2B0SUqoqT/view"
     },
     {
      "name": "2BR - E11EVEN 4310.pdf",
      "url": "https://drive.google.com/file/d/1CMaI4xn_iI_W5Ox8Spp1cwrb7BdwMCS4/view"
     },
     {
      "name": "2BR - E11EVEN 4601.pdf",
      "url": "https://drive.google.com/file/d/19IoGce_Kh5r2-eUmJHzmt2yB1_tWuiJz/view"
     }
    ],
    "prepared": "Nov 2026",
    "status": "approved",
    "public": true
   }
  ]
 },
 {
  "id": "imp-elser",
  "name": "Elser",
  "area": "Downtown Miami",
  "plans": [
   {
    "id": "elser-studio-0",
    "type": "Studio",
    "units": [
     "2004",
     "4313"
    ],
    "lo": 47300,
    "hi": 52700,
    "adr": [
     175,
     185
    ],
    "occ": [
     74,
     78
    ],
    "preparedFor": [
     "Carolina De Vasconcelos (client)",
     "Ozan Hosgor (client)"
    ],
    "notes": [
     "Owner (Aresya LLC) moving to agreement."
    ],
    "files": [
     {
      "name": "Studio - Elser 2004.pdf",
      "url": "https://drive.google.com/file/d/1Z9tFkuK5xBbmqgpl-hl_a1qbZzeXklxS/view"
     },
     {
      "name": "Studio - Elser 4313.pdf",
      "url": "https://drive.google.com/file/d/1ELxZPG0hB-9WpLJZoHx6UVZWmD3qx24X/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "approved",
    "public": true
   },
   {
    "id": "elser-1br-1",
    "type": "1BR",
    "units": [
     "1414",
     "3119",
     "3606",
     "3607",
     "4507"
    ],
    "lo": 48500,
    "hi": 60500,
    "adr": [
     190,
     221
    ],
    "occ": [
     70,
     75
    ],
    "preparedFor": [
     "Alex Begum",
     "Karan Arora",
     "Juan Tascon (client)"
    ],
    "notes": [
     "Range version (trimmed after internal review). Per unit."
    ],
    "files": [
     {
      "name": "1BR - Elser 1414 and 3119.pdf",
      "url": "https://drive.google.com/file/d/1iMF8dOkZD0FniHnD2C9LY6I7ywHN7tZE/view"
     },
     {
      "name": "1BR - Elser 3606 and 3607.pdf",
      "url": "https://drive.google.com/file/d/1BQO6-P1rdC-w1tltJ53sZotmhsiZ5tgH/view"
     },
     {
      "name": "1BR - Elser 4507.pdf",
      "url": "https://drive.google.com/file/d/1dKyp3PYhwzq7R94KinnQHa62fKWqY8pC/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "approved",
    "public": true
   },
   {
    "id": "elser-1br-2",
    "type": "1BR",
    "units": [
     "1507",
     "1508"
    ],
    "lo": 52200,
    "hi": 62400,
    "adr": [
     196,
     222
    ],
    "occ": [
     73,
     77
    ],
    "preparedFor": [
     "Vasilii Tipa"
    ],
    "notes": [],
    "files": [
     {
      "name": "1BR - Elser 1507 and 1508.pdf",
      "url": "https://drive.google.com/file/d/1QbvFvxtPV5Xwoqe3VRQNpgv_rnmXdy8y/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "approved",
    "public": true
   },
   {
    "id": "elser-1br-3",
    "type": "1BR",
    "units": [
     "3519"
    ],
    "lo": 58900,
    "hi": 70600,
    "adr": [
     240,
     254
    ],
    "occ": [
     69,
     77
    ],
    "preparedFor": [
     "Daniela Rivera (client)"
    ],
    "notes": [],
    "files": [
     {
      "name": "1BR - Elser 3519.pdf",
      "url": "https://drive.google.com/file/d/1GrfrSxU0QI8jwoQr6FAfyiycao99G0H7/view"
     }
    ],
    "prepared": "Nov 2026",
    "status": "approved",
    "public": true
   },
   {
    "id": "elser-3br-4",
    "type": "3BR",
    "units": [
     "1509"
    ],
    "lo": 108450,
    "hi": 132550,
    "adr": [
     457,
     511
    ],
    "occ": [
     65,
     71
    ],
    "preparedFor": [
     "Vasilii Tipa"
    ],
    "notes": [],
    "files": [
     {
      "name": "3BR - Elser 1509.pdf",
      "url": "https://drive.google.com/file/d/1j7ECIXTiKqrAxPIej0oKwazHt_0xnbFd/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "approved",
    "public": true
   },
   {
    "id": "elser-3br-5",
    "type": "3BR",
    "units": [
     "3318"
    ],
    "lo": 120500,
    "hi": 135900,
    "adr": [
     486,
     516
    ],
    "occ": [
     67,
     71
    ],
    "preparedFor": [
     "Ana (client)"
    ],
    "notes": [],
    "files": [
     {
      "name": "3BR - Elser 3318.pdf",
      "url": "https://drive.google.com/file/d/1dfz5WmjNHbyDd01g0xL6q2sN6YM-bz1J/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "approved",
    "public": true
   }
  ]
 },
 {
  "id": "imp-the-crosby",
  "name": "The Crosby",
  "area": "Downtown Miami",
  "plans": [
   {
    "id": "the-crosby-studio-0",
    "type": "Studio",
    "units": [
     "2206"
    ],
    "lo": 40500,
    "hi": 47500,
    "adr": [
     158,
     174
    ],
    "occ": [
     70,
     75
    ],
    "preparedFor": [
     "David Norsoph"
    ],
    "notes": [
     "Modeled, not Crosby history (building delivered about a year ago). Scaled from the Natiivo 3210 studio, Crosby 912 1BR and Elser studio actuals."
    ],
    "files": [
     {
      "name": "Studio - Crosby 2206.pdf",
      "url": "https://drive.google.com/file/d/1q_u4U_FY80q6wnM3p5JIvdpLPgWUi9uE/view"
     }
    ],
    "prepared": "Nov 2026",
    "status": "approved",
    "public": true
   },
   {
    "id": "the-crosby-1br-1",
    "type": "1BR",
    "units": [
     "603",
     "912"
    ],
    "lo": 50100,
    "hi": 58500,
    "adr": [
     196,
     214
    ],
    "occ": [
     70,
     75
    ],
    "preparedFor": [
     "Arshad Sheikh",
     "Mark Supino"
    ],
    "notes": [
     "Pulled from the Nov 8 email to Arshad. Same numbers as 912."
    ],
    "files": [
     {
      "name": "1BR - Crosby 603.pdf",
      "url": "https://drive.google.com/file/d/1VJARIjQyerSr-5E06kphqFp8YTxGqyJB/view"
     },
     {
      "name": "1BR - Crosby 912.pdf",
      "url": "https://drive.google.com/file/d/1YnF5Ug7AjdCXLSSHDmZyY-yJna7zfHlx/view"
     }
    ],
    "prepared": "Nov 2026",
    "status": "approved",
    "public": true
   },
   {
    "id": "the-crosby-2br-2",
    "type": "2BR",
    "units": [
     "2201"
    ],
    "lo": 80900,
    "hi": 92200,
    "adr": [
     322,
     344
    ],
    "occ": [
     67,
     72
    ],
    "preparedFor": [
     "Daniela Rivera (client)"
    ],
    "notes": [
     "Owner (Glenn Lee) is signed; onboarding."
    ],
    "files": [
     {
      "name": "2BR - Crosby 2201.pdf",
      "url": "https://drive.google.com/file/d/10PE_nZSmDUTGosamKiprtqFA8BEOcbTl/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "approved",
    "public": true
   }
  ]
 },
 {
  "id": "imp-icon-brickell-tower-iii",
  "name": "Icon Brickell Tower III",
  "area": "Brickell",
  "plans": [
   {
    "id": "icon-brickell-tower-iii-1br-0",
    "type": "1BR",
    "units": [
     "2806"
    ],
    "lo": 73800,
    "hi": 86400,
    "adr": [
     266,
     289
    ],
    "occ": [
     76,
     82
    ],
    "preparedFor": [
     "Stephane and Veronique Georgeon"
    ],
    "notes": [
     "PriceLabs Icon III 1BR basis."
    ],
    "files": [
     {
      "name": "1BR - Icon Brickell III 2806.pdf",
      "url": "https://drive.google.com/file/d/1KGwWxERx2C3y_KX-ZNwrQs4mDxUie2ix/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "pending",
    "public": false
   },
   {
    "id": "icon-brickell-tower-iii-2br-1",
    "type": "2BR",
    "units": [
     "2510",
     "3810"
    ],
    "lo": 103800,
    "hi": 121400,
    "adr": [
     395,
     438
    ],
    "occ": [
     72,
     76
    ],
    "preparedFor": [
     "Harout Darzyan",
     "Fara (owner)"
    ],
    "notes": [
     "Base = PriceLabs Icon III 2BR estimate; high end about +17%. ADR and occupancy are back-solved. Ryan has not approved. Discloses Tower III renovation into 2027.",
     "Built Nov 11 on the same basis as 2510. Ryan has not approved."
    ],
    "files": [
     {
      "name": "2BR - Icon Brickell III 2510.pdf",
      "url": "https://drive.google.com/file/d/1akqBQlwxHRniEeBBUUe7aR1n4Uz1-QTy/view"
     },
     {
      "name": "2BR - Icon Brickell III 3810.pdf",
      "url": "https://drive.google.com/file/d/1774lEOorw-4RURZVdQdbBkOdT2JeMoJB/view"
     }
    ],
    "prepared": "Nov 2026",
    "status": "pending",
    "public": false
   }
  ]
 },
 {
  "id": "imp-nomad-wynwood",
  "name": "NoMad Wynwood",
  "area": "Wynwood",
  "plans": [
   {
    "id": "nomad-wynwood-studio-0",
    "type": "Studio",
    "units": [],
    "lo": 49800,
    "hi": 56800,
    "adr": [
     183,
     195
    ],
    "occ": [
     73,
     78
    ],
    "preparedFor": [
     "Bruno and Carlos Homedes"
    ],
    "notes": [
     "Ryan has not reviewed the NoMad sheets."
    ],
    "files": [
     {
      "name": "Studio - NoMad Wynwood (Homedes).pdf",
      "url": "https://drive.google.com/file/d/1LPbjXi5kMA8wxIgMy_FkDknuc0x3dx3g/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "pending",
    "public": false
   },
   {
    "id": "nomad-wynwood-studio-1",
    "type": "Studio",
    "units": [
     "845"
    ],
    "lo": 57300,
    "hi": 65300,
    "adr": [
     210,
     224
    ],
    "occ": [
     73,
     78
    ],
    "preparedFor": [
     "Jose Osorio Suarez (client)"
    ],
    "notes": [],
    "files": [
     {
      "name": "Studio - NoMad Wynwood 845.pdf",
      "url": "https://drive.google.com/file/d/1X8OPF35gaNeHOotsOuX6ArsFJFJhoY53/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "pending",
    "public": false
   },
   {
    "id": "nomad-wynwood-1br-2",
    "type": "1BR",
    "units": [
     "709",
     "717"
    ],
    "lo": 54900,
    "hi": 60800,
    "adr": [
     187,
     197
    ],
    "occ": [
     80,
     84
    ],
    "preparedFor": [
     "Darin Feldman (client)",
     "Talita Pinheiro",
     "Patricia Alfonso (client)"
    ],
    "notes": [
     "Also in the Rider packet as the 1BR basis."
    ],
    "files": [
     {
      "name": "1BR - NoMad Wynwood (Darin).pdf",
      "url": "https://drive.google.com/file/d/1DA6qPVPTBMuNWHmkayrEy-gQ21eslnM2/view"
     },
     {
      "name": "1BR - NoMad Wynwood 709.pdf",
      "url": "https://drive.google.com/file/d/1yVCxWwZbbOOBaGBBlvEeduG8f1z9xzCR/view"
     },
     {
      "name": "1BR - NoMad Wynwood 717.pdf",
      "url": "https://drive.google.com/file/d/1ipFvuBMSjxnyxvgZnv9nT5oGfoYjg71C/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "pending",
    "public": false
   },
   {
    "id": "nomad-wynwood-2br-3",
    "type": "2BR",
    "units": [
     "237",
     "422"
    ],
    "lo": 79600,
    "hi": 88200,
    "adr": [
     271,
     286
    ],
    "occ": [
     80,
     84
    ],
    "preparedFor": [
     "Talita Pinheiro",
     "Rodolphe Acelor"
    ],
    "notes": [],
    "files": [
     {
      "name": "2BR - NoMad Wynwood 237.pdf",
      "url": "https://drive.google.com/file/d/1jLSBjSKTyIK4df7tn9kMW7LAjRmdVKBe/view"
     },
     {
      "name": "2BR - NoMad Wynwood 422.pdf",
      "url": "https://drive.google.com/file/d/1xhZ1ZgxjMaYFXmBz4Mj-82y-k0vqF9o0/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "pending",
    "public": false
   }
  ]
 },
 {
  "id": "imp-natiivo",
  "name": "Natiivo",
  "area": "Downtown Miami",
  "plans": [
   {
    "id": "natiivo-studio-0",
    "type": "Studio",
    "units": [
     "3210"
    ],
    "lo": 41000,
    "hi": 49000,
    "adr": [
     160,
     180
    ],
    "occ": [
     70,
     75
    ],
    "preparedFor": [
     "Talita Pinheiro (client)"
    ],
    "notes": [],
    "files": [
     {
      "name": "Studio - Natiivo 3210.pdf",
      "url": "https://drive.google.com/file/d/1F6ZDmrWtEzDEYJQ8h_dFdIKwZRK1a2rR/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "approved",
    "public": true
   },
   {
    "id": "natiivo-1br-1",
    "type": "1BR",
    "units": [
     "4607"
    ],
    "lo": 70600,
    "hi": 79200,
    "adr": [
     252,
     267
    ],
    "occ": [
     79,
     84
    ],
    "preparedFor": [
     "Patricia Alfonso (client)"
    ],
    "notes": [],
    "files": [
     {
      "name": "1BR - Natiivo 4607.pdf",
      "url": "https://drive.google.com/file/d/1rlM5oGc8HO_9M65E3TIRoVN-jDY1n1Xp/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "approved",
    "public": true
   },
   {
    "id": "natiivo-2br-2",
    "type": "2BR",
    "units": [
     "3202"
    ],
    "lo": 84700,
    "hi": 102400,
    "adr": [
     386,
     424
    ],
    "occ": [
     60,
     66
    ],
    "preparedFor": [
     "Heather Grimes"
    ],
    "notes": [
     "PriceLabs-based; monthly shape used in the Rider chart."
    ],
    "files": [
     {
      "name": "2BR - Natiivo 3202.pdf",
      "url": "https://drive.google.com/file/d/1VMqHDiXhGRTUIDNyBgqeC-bWPl3101-N/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "approved",
    "public": true
   }
  ]
 },
 {
  "id": "imp-gale-residences",
  "name": "Gale Residences",
  "area": "Fort Lauderdale",
  "plans": [
   {
    "id": "gale-residences-studio-0",
    "type": "Studio",
    "units": [
     "3214"
    ],
    "lo": 49500,
    "hi": 58500,
    "adr": [
     184,
     200
    ],
    "occ": [
     73,
     79
    ],
    "preparedFor": [
     "Cindy Perez (client)"
    ],
    "notes": [
     "Current manager reports $43,232 gross in 2025."
    ],
    "files": [
     {
      "name": "Studio - Gale 3214.pdf",
      "url": "https://drive.google.com/file/d/15AE3-i6wmTazwC3nFmdxQuIdYM1xOrht/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "approved",
    "public": true
   },
   {
    "id": "gale-residences-1br-1",
    "type": "1BR",
    "units": [
     "3214"
    ],
    "lo": 70600,
    "hi": 79200,
    "adr": [
     252,
     267
    ],
    "occ": [
     79,
     84
    ],
    "preparedFor": [
     "Jared Lake (client)",
     "Cindy Perez (client)"
    ],
    "notes": [
     "Same numbers as the 3214 1BR."
    ],
    "files": [
     {
      "name": "1BR - Gale (Jared Lake client).pdf",
      "url": "https://drive.google.com/file/d/1rQI0a518TquhR_y01KUR8MoEIeE_q41z/view"
     },
     {
      "name": "1BR - Gale 3214.pdf",
      "url": "https://drive.google.com/file/d/1E1GCxNuOeMTBBHlovEOQuMyS9mnRmKP6/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "approved",
    "public": true
   },
   {
    "id": "gale-residences-2br-2",
    "type": "2BR",
    "units": [
     "4602"
    ],
    "lo": 84700,
    "hi": 102400,
    "adr": [
     332,
     379
    ],
    "occ": [
     70,
     74
    ],
    "preparedFor": [
     "Daniela Rivera (buyer)"
    ],
    "notes": [
     "Buyer is making an offer."
    ],
    "files": [
     {
      "name": "2BR - Gale 4602.pdf",
      "url": "https://drive.google.com/file/d/1NRlg8soBgQ8a5LvM7v4Fg0Lxiuuk4DOu/view"
     }
    ],
    "prepared": "Nov 2026",
    "status": "approved",
    "public": true
   }
  ]
 },
 {
  "id": "imp-domus-brickell-park",
  "name": "Domus Brickell Park",
  "area": "Brickell",
  "plans": [
   {
    "id": "domus-brickell-park-studio-0",
    "type": "Studio",
    "units": [],
    "lo": 54900,
    "hi": 67700,
    "adr": [
     212,
     235
    ],
    "occ": [
     77,
     85
    ],
    "preparedFor": [
     "Osorio Suarez Team clients"
    ],
    "notes": [
     "Studio = 1BR less 15%."
    ],
    "files": [
     {
      "name": "Studio - Domus Brickell Park.pdf",
      "url": "https://drive.google.com/file/d/1jdH-OKRJccPyRu7LvJRIzKBeXHyTVkvn/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "approved",
    "public": true
   },
   {
    "id": "domus-brickell-park-1br-1",
    "type": "1BR",
    "units": [],
    "lo": 64600,
    "hi": 79600,
    "adr": [
     249,
     276
    ],
    "occ": [
     77,
     85
    ],
    "preparedFor": [
     "Osorio Suarez Team clients"
    ],
    "notes": [],
    "files": [
     {
      "name": "1BR - Domus Brickell Park.pdf",
      "url": "https://drive.google.com/file/d/1xssBz6J2Sh74voM6YholUH_u9CZ7LTXw/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "approved",
    "public": true
   },
   {
    "id": "domus-brickell-park-2br-2",
    "type": "2BR",
    "units": [
     "816"
    ],
    "lo": 96500,
    "hi": 103400,
    "adr": [
     344,
     357
    ],
    "occ": [
     78,
     80
    ],
    "preparedFor": [
     "Osorio Suarez Team clients"
    ],
    "notes": [
     "Built from the unit 816 947 sq ft corner sheet."
    ],
    "files": [
     {
      "name": "2BR - Domus Brickell Park.pdf",
      "url": "https://drive.google.com/file/d/1hll1Vy2-WnZwH2l_fPz-ztrLXASnktzu/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "approved",
    "public": true
   }
  ]
 },
 {
  "id": "imp-district-225",
  "name": "District 225",
  "area": "Edgewater",
  "plans": [
   {
    "id": "district-225-studio-0",
    "type": "Studio",
    "units": [
     "906"
    ],
    "lo": 47500,
    "hi": 52500,
    "adr": [
     189,
     199
    ],
    "occ": [
     64,
     67
    ],
    "preparedFor": [
     "Sandra Paredes"
    ],
    "notes": [],
    "files": [
     {
      "name": "Studio - District 225 906.pdf",
      "url": "https://drive.google.com/file/d/1ERNBjRLEVH1fHdkqgofM7Fhu8Q9uhBeo/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "approved",
    "public": true
   }
  ]
 },
 {
  "id": "imp-amrit-ocean-resort",
  "name": "Amrit Ocean Resort",
  "area": "Singer Island",
  "plans": [
   {
    "id": "amrit-ocean-resort-2br-0",
    "type": "2BR",
    "units": [],
    "lo": 155500,
    "hi": 178200,
    "adr": [
     677,
     725
    ],
    "occ": [
     65,
     70
    ],
    "preparedFor": [
     "Kira"
    ],
    "notes": [],
    "files": [
     {
      "name": "2BR - Amrit Ocean Resort (Kira).pdf",
      "url": "https://drive.google.com/file/d/1NhUMpEzby7J2ziveYkaTuqxd74YDfCyh/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "approved",
    "public": true
   }
  ]
 },
 {
  "id": "imp-hyde-beach-house",
  "name": "Hyde Beach House",
  "area": "Hollywood",
  "plans": [
   {
    "id": "hyde-beach-house-2br-0",
    "type": "2BR",
    "units": [
     "T4003"
    ],
    "lo": 96000,
    "hi": 110400,
    "adr": [
     376,
     403
    ],
    "occ": [
     70,
     75
    ],
    "preparedFor": [
     "Pablo Querubin"
    ],
    "notes": [
     "High end is above PriceLabs' upscale 2BR top of range ($90.6K). Owner self-manages at about $80K. Confirm before using externally."
    ],
    "files": [
     {
      "name": "2BR - Hyde Beach House T4003.pdf",
      "url": "https://drive.google.com/file/d/1n09HnsH5qWCXrzKdw8Bqb0YTpetPK-ZL/view"
     }
    ],
    "prepared": "Nov 2026",
    "status": "caveat",
    "public": false
   }
  ]
 },
 {
  "id": "imp-w-fort-lauderdale",
  "name": "W Fort Lauderdale",
  "area": "Fort Lauderdale",
  "plans": [
   {
    "id": "w-fort-lauderdale-2br-0",
    "type": "2BR",
    "units": [
     "2205",
     "1406"
    ],
    "lo": 135000,
    "hi": 154900,
    "adr": [
     507,
     551
    ],
    "occ": [
     73,
     77
    ],
    "preparedFor": [
     "Mike Maayeh",
     "Shaker and Rashi"
    ],
    "notes": [
     "PriceLabs W 2BR raised about 8%.",
     "13-page proposal. Same basis as 2205."
    ],
    "files": [
     {
      "name": "2BR - W Fort Lauderdale 2205.pdf",
      "url": "https://drive.google.com/file/d/10D-bq0HZUXTxL6d799yUYCRgoORGlpoS/view"
     },
     {
      "name": "Full owner proposal - W Fort Lauderdale 1406 (Shaker, 2BR).pdf",
      "url": "https://drive.google.com/file/d/1Y-sA5BGnPWwr5aEIMqIBS_IvfqvcRlOc/view"
     }
    ],
    "prepared": "Nov 2026",
    "status": "approved",
    "public": true
   }
  ]
 },
 {
  "id": "imp-29-indian-creek",
  "name": "29 Indian Creek",
  "area": "Miami Beach",
  "plans": [
   {
    "id": "29-indian-creek-1br-0",
    "type": "1BR",
    "units": [
     "604"
    ],
    "lo": 196800,
    "hi": 216480,
    "adr": [
     736,
     772
    ],
    "occ": [
     80,
     84
    ],
    "preparedFor": [
     "Albert Bell (client)"
    ],
    "notes": [
     "Daily-rental basis. Albert says the association requires 30-day minimum leases, so these may not apply. Not confirmed in condo docs."
    ],
    "files": [
     {
      "name": "29 Indian Creek 604 (1BR).pdf",
      "url": "https://drive.google.com/file/d/1nSkI2X8HBOGbL5YLdk4cQWcHPgRbmdwL/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "caveat",
    "public": false
   },
   {
    "id": "29-indian-creek-2br-1",
    "type": "2BR",
    "units": [
     "401"
    ],
    "lo": 319300,
    "hi": 351200,
    "adr": [
     1149,
     1205
    ],
    "occ": [
     84,
     88
    ],
    "preparedFor": [
     "Albert Bell (client)"
    ],
    "notes": [
     "Same 30-day-minimum caveat."
    ],
    "files": [
     {
      "name": "29 Indian Creek 401 (2BR).pdf",
      "url": "https://drive.google.com/file/d/1P1TGtThke3ePPjNDwuFEWTiHi6_upA5e/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "caveat",
    "public": false
   },
   {
    "id": "29-indian-creek-3br-2",
    "type": "3BR",
    "units": [
     "Townhome THA"
    ],
    "lo": 418400,
    "hi": 460200,
    "adr": [
     1541,
     1616
    ],
    "occ": [
     78,
     82
    ],
    "preparedFor": [
     "Albert Bell (client)"
    ],
    "notes": [
     "Same 30-day-minimum caveat."
    ],
    "files": [
     {
      "name": "29 Indian Creek Townhome (3BR).pdf",
      "url": "https://drive.google.com/file/d/1MeFUHMt9fGek9OpbdFj4kzb6mjzrw8HB/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "caveat",
    "public": false
   }
  ]
 },
 {
  "id": "imp-circ-residences",
  "name": "CIRC Residences",
  "area": "Hollywood",
  "plans": [
   {
    "id": "circ-residences-1br-30-day-0",
    "type": "1BR (30-day)",
    "units": [
     "703"
    ],
    "lo": 37100,
    "hi": 40100,
    "adr": [],
    "occ": [
     82,
     89
    ],
    "preparedFor": [
     "Gustavo Landaeta (client)"
    ],
    "notes": [
     "30+ day stays, not nightly. Net to owner $28,500 - $31,100."
    ],
    "files": [
     {
      "name": "CIRC Residences 703 (1BR) - 30-day rental projection.pdf",
      "url": "https://drive.google.com/file/d/1UvLlhH_RXp8H2tlkvzM3344Z2YD3_UIv/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "caveat",
    "public": false
   }
  ]
 },
 {
  "id": "imp-beachwalk-resort",
  "name": "Beachwalk Resort",
  "area": "Hallandale Beach",
  "plans": [
   {
    "id": "beachwalk-resort-2br-0",
    "type": "2BR",
    "units": [],
    "lo": 51400,
    "hi": 72600,
    "adr": [
     244,
     244
    ],
    "occ": [
     71,
     71
    ],
    "preparedFor": [
     "Internal"
    ],
    "notes": [
     "Unbranded PriceLabs estimate, not a Stay projection."
    ],
    "files": [
     {
      "name": "Beachwalk Resort 2BR - PriceLabs estimate.pdf",
      "url": "https://drive.google.com/file/d/1XGLONoTRv8VWE0Naxf4B1qYMVoxTPKn1/view"
     }
    ],
    "prepared": "Nov 2026",
    "status": "caveat",
    "public": false
   }
  ]
 },
 {
  "id": "imp-lighthouse-point-2501-ne-51st-st",
  "name": "Lighthouse Point home (2501 NE 51st St)",
  "area": "Lighthouse Point",
  "plans": [
   {
    "id": "lighthouse-point-2501-ne-51st-st-4br-0",
    "type": "4BR",
    "units": [],
    "lo": 115500,
    "hi": 131000,
    "adr": [
     484,
     515
    ],
    "occ": [
     64,
     68
    ],
    "preparedFor": [
     "Cindy Perez (client)"
    ],
    "notes": [],
    "files": [
     {
      "name": "Single-family 4BR - Lighthouse Point.pdf",
      "url": "https://drive.google.com/file/d/1ovxbfOcAgjhr4EKUA5pJpl6L_clUz2Az/view"
     }
    ],
    "prepared": "Oct 2026",
    "status": "approved",
    "public": true
   }
  ]
 }
]
