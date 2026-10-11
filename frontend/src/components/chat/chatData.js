// Themed imagery and follow-up question pools for the chat experience.
// Kept out of the components so the data can be tweaked without touching logic.

import pyramids from "../../Assets/Images/Pyramids.png";
import sabilKuttab from "../../Assets/Images/sabil-kuttab.jpg";
import romanAmphitheater from "../../Assets/Images/roman-amphitheater.jpg";
import catacombsKomElShoqafa from "../../Assets/Images/catacombsKomElShoqafa.jpg";
import pompeysPillar from "../../Assets/Images/pompeysPillar.jpg";
import blackPyramid from "../../Assets/Images/blackPyramid.jpg";
import greatPyramid from "../../Assets/Images/greatPyramid.jpg";
import khafrePyramid from "../../Assets/Images/khafrePyramid.jpg";
import menkaurePyramid from "../../Assets/Images/menkaurePyramid.jpg";
import sphinxGiza from "../../Assets/Images/sphinxGiza.jpg";
import karnakTemple from "../../Assets/Images/karnakTemple.jpg";
import luxorTemple from "../../Assets/Images/luxorTemple.jpg";
import valleyOfTheKings from "../../Assets/Images/valleyOfTheKings.jpg";
import abuSimbelTemple from "../../Assets/Images/abuSimbelTemple.jpg";
import philaeTemple from "../../Assets/Images/philaeTemple.jpg";
import saqqaraStepPyramid from "../../Assets/Images/saqqaraStepPyramid.jpg";

export const DEFAULT_BACKGROUND = pyramids;

/* Fallback corpus: the document /query targets when the user hasn't picked
   one — mirrors DEFAULT_DOCUMENT in the backend's ragController. */
export const DEFAULT_DOCUMENT = "egyptian_history";

/* Keywords in the last user message → themed background image.
   Order is semantic: matching uses find() (first match wins), so named
   monuments come first and generic place/era keywords ("giza", "alexandria",
   "pyramids", "roman") live only in the fallback rules at the end — a query
   like "the catacombs of Alexandria" hits catacombs before "alexandria". */
export const BACKGROUND_IMAGE_RULES = [
  { keywords: ["sabil kuttab", "abd elrahman katkhuda"], img: sabilKuttab },
  {
    keywords: [
      "catacombs",
      "kom el-shoqafa",
      "rock-cut tombs",
      "burial site",
      "2nd century",
    ],
    img: catacombsKomElShoqafa,
  },
  {
    keywords: [
      "pompey's pillar",
      "pillar of pompey",
      "roman column",
      "granite column",
      "serapeum",
      "ruins of serapeum",
      "diocletian",
      "3rd century",
      "monument",
    ],
    img: pompeysPillar,
  },
  {
    keywords: [
      "sphinx",
      "great sphinx",
      "sphinx of giza",
      "khafre sphinx",
      "lion statue",
      "guardian of pyramids",
    ],
    img: sphinxGiza,
  },
  {
    keywords: [
      "great pyramid",
      "pyramid of khufu",
      "great pyramid of giza",
      "cheops",
      "largest pyramid",
      "seven wonders",
      "old kingdom",
    ],
    img: greatPyramid,
  },
  {
    keywords: [
      "pyramid of khafre",
      "khafre",
      "chephren",
      "middle pyramid",
      "second pyramid",
    ],
    img: khafrePyramid,
  },
  {
    keywords: [
      "pyramid of menkaure",
      "menkaure",
      "third pyramid",
      "smallest pyramid",
    ],
    img: menkaurePyramid,
  },
  {
    keywords: [
      "black pyramid",
      "king amenemhat iii",
      "amenemhat pyramid",
      "dahshur",
      "mudbrick pyramid",
      "collapsed pyramid",
      "middle kingdom",
    ],
    img: blackPyramid,
  },
  {
    keywords: [
      "saqqara",
      "saqqara step pyramid",
      "step pyramid",
      "pyramid of djoser",
      "djoser",
      "oldest pyramid",
      "memphis",
    ],
    img: saqqaraStepPyramid,
  },
  {
    keywords: [
      "valley of the kings",
      "royal tombs",
      "pharaoh tombs",
      "tutankhamun",
      "necropolis",
    ],
    img: valleyOfTheKings,
  },
  {
    keywords: [
      "luxor temple",
      "temple of luxor",
      "luxor",
      "night temple",
      "obelisk",
    ],
    img: luxorTemple,
  },
  {
    keywords: [
      "temple of karnak",
      "karnak",
      "thebes",
      "amun",
      "hypostyle hall",
      "ancient temple",
      "egyptian temples",
      "new kingdom",
    ],
    img: karnakTemple,
  },
  {
    keywords: [
      "temple of abu simbel",
      "abu simbel",
      "ramses ii",
      "nubia",
      "rock-cut temple",
      "sun festival",
      "aswan",
      "great temple",
    ],
    img: abuSimbelTemple,
  },
  {
    keywords: [
      "philae temple",
      "philae",
      "philae island",
      "isis temple",
      "temple of isis",
      "island temple",
      "ancient egyptian temple",
      "greco-roman egypt",
    ],
    img: philaeTemple,
  },
  // Alexandria / Greco-Roman fallback — broad "alexandria", "greco", "roman"
  // catch only what the monument rules above didn't claim.
  {
    keywords: [
      "roman amphitheater",
      "kom el-dikka",
      "alexandria",
      "greco",
      "roman",
    ],
    img: romanAmphitheater,
  },
  // Catch-all Egypt/pyramids fallback — always last.
  {
    keywords: ["pyramids", "giza", "egypt pyramids", "ancient egypt"],
    img: pyramids,
  },
];

/* Follow-up question pools keyed by topic, used to build suggestion buttons. */
export const TOPIC_SUGGESTIONS = {
  pyramids: [
    "How were the pyramids built?",
    "Who were the pharaohs buried in pyramids?",
    "What's inside the pyramids?",
    "How long did it take to build the Great Pyramid?",
    "What tools did they use to build pyramids?",
    "Why were pyramids built in that shape?",
    "How many pyramids are there in Egypt?",
    "What was the purpose of the pyramid complex?",
    "How did they transport the stones?",
    "What's the significance of pyramid alignment?"
  ],
  temples: [
    "What was the purpose of Egyptian temples?",
    "How were temples decorated?",
    "Who could enter temples?",
    "What ceremonies took place in temples?",
    "How were temples funded?",
    "What's the difference between mortuary and cult temples?",
    "How were temples oriented?",
    "What role did priests play in temples?",
    "How were temples maintained?",
    "What happened during temple festivals?"
  ],
  pharaohs: [
    "How did pharaohs rule Egypt?",
    "What was the role of pharaohs in religion?",
    "How were pharaohs chosen?",
    "What powers did pharaohs have?",
    "How did pharaohs communicate with the gods?",
    "What was the pharaoh's daily life like?",
    "How were pharaohs buried?",
    "What titles did pharaohs have?",
    "How did pharaohs maintain power?",
    "What happened when a pharaoh died?"
  ],
  gods: [
    "Who were the main Egyptian gods?",
    "How did Egyptians worship their gods?",
    "What were Egyptian religious beliefs?",
    "What was the role of animal gods?",
    "How were gods represented in art?",
    "What were the major religious festivals?",
    "How did gods influence daily life?",
    "What was the relationship between gods and pharaohs?",
    "How were gods worshipped in homes?",
    "What happened to Egyptian religion over time?"
  ],
  afterlife: [
    "What did Egyptians believe about the afterlife?",
    "How did they prepare for death?",
    "What was mummification?",
    "What was the Book of the Dead?",
    "How did they judge souls in the afterlife?",
    "What was the journey to the afterlife like?",
    "What did they bury with the dead?",
    "How did they protect tombs?",
    "What was the role of the heart in the afterlife?",
    "How did beliefs about the afterlife change?"
  ],
  alexandria: [
    "What was Alexandria like in ancient times?",
    "Who founded Alexandria?",
    "What was the Library of Alexandria?",
    "What happened to the Pharos Lighthouse?",
    "What was Cleopatra's role in Alexandria?",
    "How did Alexandria become a center of learning?",
    "What was the cultural mix in Alexandria?",
    "How did Alexandria influence the Mediterranean?",
    "What remains of ancient Alexandria today?",
    "What was the significance of Alexandria's location?"
  ],
  cairo: [
    "What was Cairo like in ancient times?",
    "How did Cairo develop over time?",
    "What are the oldest parts of Cairo?",
    "What was the role of Cairo in Islamic Egypt?",
    "How did Cairo become the capital?",
    "What architectural styles are found in Cairo?",
    "What was medieval Cairo like?",
    "How did Cairo influence trade routes?",
    "What are Cairo's most important monuments?",
    "How has Cairo changed over centuries?"
  ],
  sphinx: [
    "What is the Great Sphinx?",
    "Who built the Sphinx?",
    "What does the Sphinx represent?",
    "How old is the Sphinx?",
    "What was the Sphinx's original purpose?",
    "How was the Sphinx carved?",
    "What happened to the Sphinx's nose?",
    "What's the connection between the Sphinx and pyramids?",
    "How has the Sphinx been restored?",
    "What mysteries surround the Sphinx?"
  ],
  valley: [
    "What is the Valley of the Kings?",
    "Why was it chosen for royal burials?",
    "How many tombs are in the Valley?",
    "What was the most famous discovery there?",
    "How were the tombs decorated?",
    "What was the purpose of the valley?",
    "How did they protect the tombs?",
    "What happened to the valley over time?",
    "How were the tombs discovered?",
    "What treasures were found in the valley?"
  ],
  nile: [
    "What was the importance of the Nile?",
    "How did the Nile shape Egyptian civilization?",
    "What was the annual flooding like?",
    "How did Egyptians use the Nile for transport?",
    "What was the Nile's role in agriculture?",
    "How did the Nile influence religion?",
    "What was the Nile's role in trade?",
    "How did they navigate the Nile?",
    "What was the Nile's role in warfare?",
    "How has the Nile changed over time?"
  ],
  hieroglyphs: [
    "What are hieroglyphs?",
    "How were hieroglyphs deciphered?",
    "What was the Rosetta Stone?",
    "How many hieroglyphic symbols were there?",
    "Who could read and write hieroglyphs?",
    "How were hieroglyphs used?",
    "What other writing systems did Egyptians use?",
    "How did hieroglyphs evolve?",
    "What was the purpose of hieroglyphs?",
    "How do we translate hieroglyphs today?"
  ]
};

export const GENERAL_SUGGESTIONS = [
  "What was daily life like in ancient Egypt?",
  "How did ancient Egyptians view time?",
  "What was the role of women in ancient Egypt?",
  "How did ancient Egyptians trade with other civilizations?",
  "What was the education system like?",
  "How did ancient Egyptians measure time?",
  "What was the role of music in ancient Egypt?",
  "How did ancient Egyptians view foreigners?",
  "What was the role of magic in ancient Egypt?",
  "How did ancient Egyptians view the stars?"
];

/* Shown on the empty state so a first-time user can start with one click. */
export const STARTER_QUESTIONS = [
  "How were the pyramids built?",
  "What is the Great Sphinx?",
  "What was the Library of Alexandria?",
];
