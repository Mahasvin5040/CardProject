
//suits: ♠, ♥, ♦, ♣
/*
class Card {
  constructor(value, suit) {
    this.value = value;
    this.suit = suit;
    this.order = valueConverter(value);
  }
}

function valueConverter(value) {
    if (value == 14) {
        return 'A';
    }
    else if (value == 13) {
        return 'K';
    }
    else if (value == 12) {
        return 'Q';
    }
    else if (value == 11) {
        return 'J';
    }
    else {
        return String(value);
    }
}
*/

// ==========================================
// 1. CONSTANTS & SETUP
// ==========================================
const SUITS = ['♠', '♥', '♦', '♣'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function getCardColor(suit) {
  if (suit === '♠' || suit === '♣') return 'black';
  if (suit === '♥' || suit === '♦') return 'red';
  return 'joker_' + suit; // each Joker suit gets its own unique color category so they never match
}

// ==========================================
// 2. CORE DECK FUNCTIONS
// ==========================================

/**
 * Generates a standard 52-card deck, then adds the configured number of Jokers.
 * Each Joker has a distinct suit and value so they cannot be paired together.
 */
function createZombieDeck(jokerCount = 1) {
  const deck = [];

  // Generate all 52 cards
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({ suit, value });
    }
  }

  // added code: generate configurable number of jokers with unique suits and values
  const count = Math.max(1, parseInt(jokerCount, 10) || 1);
  for (let i = 1; i <= count; i++) {
    deck.push({
      suit: `Z${i}`,
      value: `z${i}`,
      isJoker: true,
      isZombie: true
    });
  }

  return deck;
}

/**
 * Shuffles an array in place using the Fisher-Yates algorithm.
 * It loops backwards through the array, picking a random remaining element 
 * and swapping it with the current element.
 */
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    // Pick a random index from 0 to i
    const j = Math.floor(Math.random() * (i + 1));

    // Swap elements deck[i] and deck[j]
    const temp = deck[i];
    deck[i] = deck[j];
    deck[j] = temp;
  }
  return deck;
}

function dealCards(deck, players) {
  // Reset hands just in case
  players.forEach(player => player.hand = []);

  // Distribute cards one by one to players sequentially
  deck.forEach((card, index) => {
    const playerIndex = index % players.length;
    players[playerIndex].hand.push(card);
  });
}

/**
 * Scans a player's hand, removes any pairs matching by VALUE and COLOR,
 * and leaves unmatched cards (Jokers are never discarded).
 */
function discardPairs(hand) {
  const counts = {};

  // 1. Create a unique key for each value + color combination
  // JOKERS are never paired or discarded
  hand.forEach(card => {
    if (card.isJoker || card.isZombie || (card.suit && card.suit.startsWith && card.suit.startsWith('Z')) || (card.value && card.value.startsWith && card.value.startsWith('z'))) {
      return;
    }
    const color = getCardColor(card.suit);
    const key = `${card.value}_${color}`;
    counts[key] = (counts[key] || 0) + 1;
  });

  // 2. Filter the hand using our new unique value_color keys
  return hand.filter(card => {
    if (card.isJoker || card.isZombie || (card.suit && card.suit.startsWith && card.suit.startsWith('Z')) || (card.value && card.value.startsWith && card.value.startsWith('z'))) {
      return true; // Keep ALL jokers always!
    }
    const color = getCardColor(card.suit);
    const key = `${card.value}_${color}`;
    const totalCount = counts[key];

    if (totalCount % 2 === 0) {
      // Even count means they pair off perfectly. Drop them.
      return false;
    } else {
      // Odd count means one card must remain.
      counts[key]--;
      return counts[key] === 0;
    }
  });
}





// ==========================================
// 3. TESTING THE ENGINE
// ==========================================

// Create the deck
/*
let myDeck = createOldMaidDeck();
console.log(`Deck created. Total cards: ${myDeck.length}`); // Should be 53
console.log("First 3 cards before shuffle:", myDeck.slice(0, 3));

console.log("\n--- Shuffling --- \n");

// Shuffle the deck
shuffle(myDeck);
console.log("First 3 cards after shuffle:", myDeck.slice(0, 3));

const players = [
  { id: '1', name: 'Sunny', hand: [] },
  { id: '2', name: 'Chubby', hand: [] },
  { id: '3', name: 'Chunky', hand: [] },
  { id: '4', name: 'Chinni', hand: [] }
];

dealCards(myDeck, players);

console.log("--- HANDS IMMEDIATELY AFTER DEAL ---");
players.forEach(p => {
  console.log(`${p.name} received ${p.hand.length} cards.`);
});

console.log("\n--- CLEANING HANDS (DISCARDING PAIRS) ---");
players.forEach(p => {
  const initialCount = p.hand.length;
  p.hand = discardPairs(p.hand);
  const pairsRemoved = (initialCount - p.hand.length) / 2;
  
  console.log(`${p.name} discarded ${pairsRemoved} pairs. Cards remaining: ${p.hand.length}`);
  console.log(`${p.name}'s hand:`, p.hand.map(c => `${c.value}${c.suit}`).join(', '));
  console.log('----------------------------------------------------');
});

*/
/**
 * Simulates a single player drawing a random card from their neighbor,
 * updating both hands and clearing any new pairs.
 */
function playTurn(playerDrawing, playerBeingDrawnFrom) {
  console.log(`\n=== TURN: ${playerDrawing.name} is drawing from ${playerBeingDrawnFrom.name} ===`);

  if (playerBeingDrawnFrom.hand.length === 0) {
    console.log(`${playerBeingDrawnFrom.name} has no cards left!`);
    return;
  }

  // 1. Pick a random card index from the neighbor's hand
  const randomIndex = Math.floor(Math.random() * playerBeingDrawnFrom.hand.length);

  // 2. Remove (splice) that card from the neighbor's hand
  const [stolenCard] = playerBeingDrawnFrom.hand.splice(randomIndex, 1);
  console.log(`${playerDrawing.name} drew a card face-down (It was secretly the ${stolenCard.value}${stolenCard.suit})`);

  // 3. Add the card to the drawing player's hand
  playerDrawing.hand.push(stolenCard);

  // 4. Run pair discarding on the drawing player's hand
  const cardsBeforeFilter = playerDrawing.hand.length;
  playerDrawing.hand = discardPairs(playerDrawing.hand);

  if (playerDrawing.hand.length < cardsBeforeFilter) {
    console.log(`Match! ${playerDrawing.name} formed a pair and discarded it.`);
  } else {
    console.log(`No match formed for ${playerDrawing.name}.`);
  }

  // Print updated status
  console.log(`${playerDrawing.name}'s new hand count: ${playerDrawing.hand.length}`);
  console.log(`${playerBeingDrawnFrom.name}'s new hand count: ${playerBeingDrawnFrom.hand.length}`);
}

// --- TEST THE TURN ---
// Let's make Alice (players[0]) draw from Bob (players[1])
//playTurn(players[0], players[1]);


module.exports = {
  createZombieDeck,
  shuffle,
  dealCards,
  discardPairs,
  getCardColor
};