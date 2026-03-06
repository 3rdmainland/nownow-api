/**
 * Seed script: menu items for existing vendors + bar vendors published to events.
 *
 * Usage: npx tsx scripts/seed-menus.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── Active events (those with end_date in the future) ────────────────────────
const EVENTS = {
  maXXXed:  '20607fc7-3f91-4a6e-b14e-8020737bc3ec',
  megaladon: '4729f32d-c91f-4536-81bb-573a1fec1883',
  summerFest: 'fec28b99-f4ff-4c54-b59f-9ada39842ada',
};

// ── Existing vendors ─────────────────────────────────────────────────────────
const V = {
  joesBurgers:    '0faa6466-e596-41d4-a20e-0c36416b6dfe',
  joesBurgerShack:'263649d1-72d2-4965-94a5-e52117615497',
  chaylee:        '50bfad61-6a8f-4cea-8254-3c36c399033d',
  tacoFiesta:     '520e5ed3-c3d4-4ae4-9a7b-77398d7fc55b',
  burgerBliss:    '66f480a5-daf7-4d32-9e4b-15b71bdf0a8a',
  coffeeCorner:   '70a2a460-2f6c-41b6-881d-e2e13ddc32ec',
  sweetTemptations:'82cced96-8749-4655-8cce-5877bf46a669',
  sushiStation:   'd3867f13-e2f9-4a3a-acaa-01572a449225',
  pizzaParadise:  'e7a5627f-b778-46db-a768-cdfa7c98933d',
};

// ── helpers ──────────────────────────────────────────────────────────────────
const uid = () => crypto.randomUUID();
const makeSlug = (vendorId: string, name: string) =>
  `${vendorId.slice(0, 8)}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}`;

async function upsertRows(table: string, rows: any[]) {
  const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`  OK ${table}: ${rows.length} rows`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Create bar category + bar vendors
// ═══════════════════════════════════════════════════════════════════════════════

let BAR_CAT_ID = uid();
const BAR_VENDORS = [
  {
    id: uid(),
    name: 'The Mixology Lab',
    description: 'Craft cocktails, premium spirits, and artisanal mixers',
    email: 'orders@mixologylab.co.za',
    phone: '+27123456099',
    category_id: BAR_CAT_ID,
    cuisine_type: ['Bar', 'Cocktails'],
    rating: 4.7,
    total_reviews: 215,
    location: { city: 'Johannesburg', state: 'Gauteng', address: 'Bar Stand 1', zipCode: '2000', latitude: -26.2041, longitude: 28.0473 },
    is_active: true,
    is_paused: false,
    minimum_order: null,
    estimated_prep_time: 5,
    payment_methods: ['CASH', 'CARD'],
    hours: [],
    image_url: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&q=80&w=2670',
  },
  {
    id: uid(),
    name: 'Brew & Barrel',
    description: 'Craft beers, ciders, and bar snacks',
    email: 'hello@brewbarrel.co.za',
    phone: '+27123456098',
    category_id: BAR_CAT_ID,
    cuisine_type: ['Bar', 'Craft Beer'],
    rating: 4.5,
    total_reviews: 178,
    location: { city: 'Johannesburg', state: 'Gauteng', address: 'Bar Stand 2', zipCode: '2000', latitude: -26.2041, longitude: 28.0473 },
    is_active: true,
    is_paused: false,
    minimum_order: null,
    estimated_prep_time: 3,
    payment_methods: ['CASH', 'CARD'],
    hours: [],
    image_url: 'https://images.unsplash.com/photo-1559526324-593bc073d938?auto=format&fit=crop&q=80&w=2670',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Menu categories per vendor
// ═══════════════════════════════════════════════════════════════════════════════

interface MenuCat { id: string; vendor_id: string; name: string; slug: string; display_order: number; is_active: boolean }

const menuCats: MenuCat[] = [];
const mc = (vendorId: string, name: string, order: number) => {
  const id = uid();
  menuCats.push({ id, vendor_id: vendorId, name, slug: makeSlug(vendorId, name), display_order: order, is_active: true });
  return id;
};

// Joe's burgers
const jb_burgers = mc(V.joesBurgers, 'Burgers', 0);
const jb_sides = mc(V.joesBurgers, 'Sides', 1);
const jb_drinks = mc(V.joesBurgers, 'Drinks', 2);

// Joe's Burger Shack
const jbs_signature = mc(V.joesBurgerShack, 'Signature Burgers', 0);
const jbs_classic = mc(V.joesBurgerShack, 'Classic Burgers', 1);
const jbs_sides = mc(V.joesBurgerShack, 'Sides & Extras', 2);

// Chaylee
const ch_mains = mc(V.chaylee, 'Mains', 0);
const ch_sides = mc(V.chaylee, 'Sides', 1);

// Taco Fiesta
const tf_tacos = mc(V.tacoFiesta, 'Tacos', 0);
const tf_burritos = mc(V.tacoFiesta, 'Burritos & Quesadillas', 1);
const tf_sides = mc(V.tacoFiesta, 'Sides & Drinks', 2);

// Burger Bliss
const bb_premium = mc(V.burgerBliss, 'Premium Burgers', 0);
const bb_chicken = mc(V.burgerBliss, 'Chicken Burgers', 1);
const bb_sides = mc(V.burgerBliss, 'Sides', 2);

// Coffee Corner
const cc_hot = mc(V.coffeeCorner, 'Hot Drinks', 0);
const cc_cold = mc(V.coffeeCorner, 'Cold Drinks', 1);
const cc_treats = mc(V.coffeeCorner, 'Treats', 2);

// Sweet Temptations
const st_cakes = mc(V.sweetTemptations, 'Cakes & Pastries', 0);
const st_baked = mc(V.sweetTemptations, 'Baked Goods', 1);
const st_ice = mc(V.sweetTemptations, 'Ice Cream', 2);

// Sushi Station
const ss_rolls = mc(V.sushiStation, 'Rolls', 0);
const ss_platters = mc(V.sushiStation, 'Platters', 1);
const ss_sides = mc(V.sushiStation, 'Sides', 2);

// Pizza Paradise
const pp_classic = mc(V.pizzaParadise, 'Classic Pizzas', 0);
const pp_gourmet = mc(V.pizzaParadise, 'Gourmet Pizzas', 1);
const pp_sides = mc(V.pizzaParadise, 'Sides & Drinks', 2);

// Bar vendors
const ml_cocktails = mc(BAR_VENDORS[0].id, 'Cocktails', 0);
const ml_spirits = mc(BAR_VENDORS[0].id, 'Spirits & Neat', 1);
const ml_mocktails = mc(BAR_VENDORS[0].id, 'Mocktails', 2);

const bb2_craft = mc(BAR_VENDORS[1].id, 'Craft Beers', 0);
const bb2_ciders = mc(BAR_VENDORS[1].id, 'Ciders', 1);
const bb2_snacks = mc(BAR_VENDORS[1].id, 'Bar Snacks', 2);

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Default menu items per vendor
// ═══════════════════════════════════════════════════════════════════════════════

interface MenuItem {
  id: string; vendor_id: string; category_id: string; name: string; slug: string;
  description: string; type: string; base_price: number; prep_time: number;
  availability_status: string; is_active: boolean; display_order: number;
}

const items: MenuItem[] = [];
let itemOrder = 0;
const item = (vendorId: string, catId: string, name: string, desc: string, price: number, prep: number, type = 'FOOD') => {
  const id = uid();
  items.push({
    id, vendor_id: vendorId, category_id: catId, name, slug: makeSlug(vendorId, name) + '-' + items.length,
    description: desc, type, base_price: price, prep_time: prep,
    availability_status: 'AVAILABLE', is_active: true, display_order: itemOrder++,
  });
  return id;
};

// ── Joe's burgers ────────────────────────────────────────────────────────────
item(V.joesBurgers, jb_burgers, 'Classic Smash Burger', 'Double smash patty, American cheese, pickles, special sauce', 6500, 8);
item(V.joesBurgers, jb_burgers, 'Bacon Cheese Burger', 'Smash patty, crispy bacon, cheddar, caramelised onions', 7500, 10);
item(V.joesBurgers, jb_burgers, 'Mushroom Swiss Burger', 'Smash patty, sauteed mushrooms, Swiss cheese, garlic aioli', 7000, 10);
item(V.joesBurgers, jb_sides, 'Loaded Fries', 'Seasoned fries with cheese sauce and bacon bits', 4500, 6);
item(V.joesBurgers, jb_sides, 'Onion Rings', 'Beer-battered crispy onion rings', 3500, 5);
item(V.joesBurgers, jb_drinks, 'Milkshake', 'Classic vanilla, chocolate, or strawberry', 4000, 3, 'BEVERAGE');
item(V.joesBurgers, jb_drinks, 'Soft Drink (Can)', 'Coca-Cola, Sprite, or Fanta', 2000, 1, 'BEVERAGE');

// ── Joe's Burger Shack ───────────────────────────────────────────────────────
item(V.joesBurgerShack, jbs_signature, 'The Shack Stack', 'Triple patty, triple cheese, jalapenos, Shack sauce', 9500, 12);
item(V.joesBurgerShack, jbs_signature, 'Truffle Burger', 'Wagyu patty, truffle mayo, rocket, parmesan shavings', 11000, 14);
item(V.joesBurgerShack, jbs_classic, 'Original Burger', 'Beef patty, lettuce, tomato, pickles, ketchup', 6000, 8);
item(V.joesBurgerShack, jbs_classic, 'Cheese Burger', 'Beef patty, double American cheese, pickles', 6500, 8);
item(V.joesBurgerShack, jbs_sides, 'Sweet Potato Fries', 'Crispy sweet potato fries with sriracha mayo', 4000, 6);
item(V.joesBurgerShack, jbs_sides, 'Coleslaw', 'Creamy homemade coleslaw', 2500, 2);

// ── Chaylee ──────────────────────────────────────────────────────────────────
item(V.chaylee, ch_mains, 'Grilled Chicken Wrap', 'Spiced grilled chicken, salad, garlic sauce in a tortilla', 6500, 10);
item(V.chaylee, ch_mains, 'Lamb Kofta Plate', 'Spiced lamb kofta, hummus, pita, salad', 8500, 12);
item(V.chaylee, ch_mains, 'Falafel Bowl', 'Crispy falafel, tahini, pickled veg, rice', 6000, 8);
item(V.chaylee, ch_sides, 'Hummus & Pita', 'Creamy hummus with warm pita bread', 3500, 4);
item(V.chaylee, ch_sides, 'Fattoush Salad', 'Fresh herb salad with crispy pita chips', 4000, 5);

// ── Taco Fiesta ──────────────────────────────────────────────────────────────
item(V.tacoFiesta, tf_tacos, 'Carne Asada Taco', 'Grilled steak, onion, cilantro, salsa verde (x2)', 5500, 7);
item(V.tacoFiesta, tf_tacos, 'Al Pastor Taco', 'Marinated pork, pineapple, onion, cilantro (x2)', 5000, 7);
item(V.tacoFiesta, tf_tacos, 'Fish Taco', 'Beer-battered hake, slaw, chipotle crema (x2)', 6000, 8);
item(V.tacoFiesta, tf_burritos, 'Chicken Burrito', 'Grilled chicken, rice, beans, cheese, salsa, sour cream', 7500, 10);
item(V.tacoFiesta, tf_burritos, 'Cheese Quesadilla', 'Toasted flour tortilla, melted cheese, jalapenos', 4500, 6);
item(V.tacoFiesta, tf_sides, 'Nachos Supreme', 'Corn chips, cheese, guacamole, salsa, sour cream', 5500, 5);
item(V.tacoFiesta, tf_sides, 'Horchata', 'Traditional Mexican rice milk drink', 3000, 2, 'BEVERAGE');

// ── Burger Bliss ─────────────────────────────────────────────────────────────
item(V.burgerBliss, bb_premium, 'The Bliss Burger', 'Double patty, aged cheddar, caramelised onion jam, Bliss sauce', 8500, 12);
item(V.burgerBliss, bb_premium, 'Blue Cheese & Bacon', 'Beef patty, blue cheese, crispy streaky bacon, rocket', 9000, 12);
item(V.burgerBliss, bb_premium, 'BBQ Brisket Burger', 'Smoked brisket, BBQ glaze, jalapeno slaw, pickles', 9500, 14);
item(V.burgerBliss, bb_chicken, 'Crispy Chicken Burger', 'Buttermilk fried chicken, slaw, pickles, honey mustard', 7500, 10);
item(V.burgerBliss, bb_chicken, 'Grilled Chicken Burger', 'Herb-marinated chicken breast, avocado, tomato', 7000, 10);
item(V.burgerBliss, bb_sides, 'Truffle Parmesan Fries', 'Hand-cut fries, truffle oil, parmesan, herbs', 5000, 6);
item(V.burgerBliss, bb_sides, 'Mac & Cheese Bites', 'Crispy-fried mac and cheese balls', 4500, 5);

// ── Coffee Corner ────────────────────────────────────────────────────────────
item(V.coffeeCorner, cc_hot, 'Cappuccino', 'Double-shot espresso, steamed milk, foam', 3500, 4, 'BEVERAGE');
item(V.coffeeCorner, cc_hot, 'Flat White', 'Double-shot espresso, velvety micro-foam milk', 3500, 4, 'BEVERAGE');
item(V.coffeeCorner, cc_hot, 'Chai Latte', 'Spiced chai concentrate, steamed milk', 4000, 4, 'BEVERAGE');
item(V.coffeeCorner, cc_hot, 'Hot Chocolate', 'Rich Belgian hot chocolate, marshmallows', 4000, 4, 'BEVERAGE');
item(V.coffeeCorner, cc_cold, 'Iced Latte', 'Double espresso over ice, milk', 4000, 3, 'BEVERAGE');
item(V.coffeeCorner, cc_cold, 'Cold Brew', '18-hour cold-steeped coffee, served black or with milk', 4500, 2, 'BEVERAGE');
item(V.coffeeCorner, cc_cold, 'Iced Matcha', 'Ceremonial grade matcha, oat milk, ice', 5000, 3, 'BEVERAGE');
item(V.coffeeCorner, cc_treats, 'Blueberry Muffin', 'Freshly baked blueberry muffin', 3000, 2);
item(V.coffeeCorner, cc_treats, 'Croissant', 'Butter croissant, plain or almond', 3500, 2);

// ── Sweet Temptations ────────────────────────────────────────────────────────
item(V.sweetTemptations, st_cakes, 'Red Velvet Cake Slice', 'Classic red velvet, cream cheese frosting', 5500, 3);
item(V.sweetTemptations, st_cakes, 'Chocolate Fondant', 'Warm chocolate lava cake, vanilla ice cream', 6500, 8);
item(V.sweetTemptations, st_cakes, 'New York Cheesecake', 'Baked cheesecake, berry compote', 5500, 3);
item(V.sweetTemptations, st_baked, 'Cinnamon Roll', 'Warm cinnamon roll, cream cheese glaze', 4000, 5);
item(V.sweetTemptations, st_baked, 'Chocolate Brownie', 'Fudgy dark chocolate brownie, walnuts', 4500, 3);
item(V.sweetTemptations, st_ice, 'Gelato (2 scoops)', 'Choose from: vanilla, chocolate, pistachio, strawberry', 4000, 2);
item(V.sweetTemptations, st_ice, 'Waffle Sundae', 'Belgian waffle, gelato, chocolate sauce, whipped cream', 6500, 6);

// ── Sushi Station ────────────────────────────────────────────────────────────
item(V.sushiStation, ss_rolls, 'Salmon Roses (8pc)', 'Fresh salmon, avocado, cream cheese, tobiko', 9500, 15);
item(V.sushiStation, ss_rolls, 'Rainbow Roll (8pc)', 'California roll topped with assorted sashimi', 11000, 18);
item(V.sushiStation, ss_rolls, 'Prawn Tempura Roll (8pc)', 'Crispy prawn tempura, avocado, spicy mayo', 9000, 15);
item(V.sushiStation, ss_rolls, 'Chicken Katsu Roll (8pc)', 'Crispy chicken, avocado, teriyaki drizzle', 8000, 12);
item(V.sushiStation, ss_platters, 'Sushi Platter (24pc)', "Chef's selection of maki, nigiri and sashimi", 22000, 25);
item(V.sushiStation, ss_platters, 'Sashimi Platter (18pc)', 'Salmon, tuna and yellowtail sashimi', 25000, 20);
item(V.sushiStation, ss_sides, 'Edamame', 'Steamed edamame, sea salt', 3500, 4);
item(V.sushiStation, ss_sides, 'Miso Soup', 'Traditional miso, tofu, wakame, spring onion', 3000, 5);

// ── Pizza Paradise ───────────────────────────────────────────────────────────
item(V.pizzaParadise, pp_classic, 'Margherita', 'San Marzano tomato, mozzarella, fresh basil', 7000, 12);
item(V.pizzaParadise, pp_classic, 'Pepperoni', 'Tomato, mozzarella, spicy pepperoni', 8000, 12);
item(V.pizzaParadise, pp_classic, 'Hawaiian', 'Tomato, mozzarella, ham, pineapple', 8000, 12);
item(V.pizzaParadise, pp_gourmet, 'Truffle Mushroom', 'Truffle cream base, wild mushrooms, rocket, parmesan', 11000, 15);
item(V.pizzaParadise, pp_gourmet, 'Nduja & Burrata', 'Spicy nduja, burrata, cherry tomato, basil', 12000, 15);
item(V.pizzaParadise, pp_gourmet, 'Fig & Prosciutto', 'Fig jam, prosciutto, gorgonzola, rocket, honey', 12500, 15);
item(V.pizzaParadise, pp_sides, 'Garlic Bread', 'Wood-fired garlic bread, herb butter', 3500, 6);
item(V.pizzaParadise, pp_sides, 'Tiramisu', 'Classic Italian tiramisu', 5500, 3);

// ── The Mixology Lab ─────────────────────────────────────────────────────────
item(BAR_VENDORS[0].id, ml_cocktails, 'Mojito', 'White rum, fresh mint, lime, soda, sugar', 7500, 4, 'BEVERAGE');
item(BAR_VENDORS[0].id, ml_cocktails, 'Espresso Martini', 'Vodka, coffee liqueur, fresh espresso, vanilla', 8500, 5, 'BEVERAGE');
item(BAR_VENDORS[0].id, ml_cocktails, 'Aperol Spritz', 'Aperol, prosecco, soda, orange slice', 8000, 3, 'BEVERAGE');
item(BAR_VENDORS[0].id, ml_cocktails, 'Margarita', 'Tequila, triple sec, lime juice, salt rim', 8000, 4, 'BEVERAGE');
item(BAR_VENDORS[0].id, ml_cocktails, 'Old Fashioned', 'Bourbon, bitters, sugar, orange peel', 9000, 4, 'BEVERAGE');
item(BAR_VENDORS[0].id, ml_spirits, 'Whisky (Single)', 'Premium single malt, your choice', 7000, 2, 'BEVERAGE');
item(BAR_VENDORS[0].id, ml_spirits, 'Gin & Tonic', 'Craft gin, premium tonic, botanicals', 7000, 3, 'BEVERAGE');
item(BAR_VENDORS[0].id, ml_spirits, 'Vodka Soda', 'Premium vodka, soda water, lime', 6000, 2, 'BEVERAGE');
item(BAR_VENDORS[0].id, ml_mocktails, 'Virgin Mojito', 'Fresh mint, lime, soda, sugar - no alcohol', 5000, 3, 'BEVERAGE');
item(BAR_VENDORS[0].id, ml_mocktails, 'Passionfruit Spritzer', 'Passionfruit, sparkling water, mint', 4500, 3, 'BEVERAGE');

// ── Brew & Barrel ────────────────────────────────────────────────────────────
item(BAR_VENDORS[1].id, bb2_craft, 'Pale Ale', 'Hoppy American-style pale ale, 500ml', 5500, 2, 'BEVERAGE');
item(BAR_VENDORS[1].id, bb2_craft, 'IPA', 'West Coast IPA, citrus and pine notes, 500ml', 6000, 2, 'BEVERAGE');
item(BAR_VENDORS[1].id, bb2_craft, 'Lager', 'Crisp craft lager, 500ml', 5000, 2, 'BEVERAGE');
item(BAR_VENDORS[1].id, bb2_craft, 'Stout', 'Chocolate coffee stout, 500ml', 6000, 2, 'BEVERAGE');
item(BAR_VENDORS[1].id, bb2_ciders, 'Apple Cider', 'Dry apple cider, 330ml', 5000, 2, 'BEVERAGE');
item(BAR_VENDORS[1].id, bb2_ciders, 'Pear Cider', 'Semi-sweet pear cider, 330ml', 5000, 2, 'BEVERAGE');
item(BAR_VENDORS[1].id, bb2_snacks, 'Biltong Board', 'Selection of beef biltong, droewors, chilli bites', 7500, 4);
item(BAR_VENDORS[1].id, bb2_snacks, 'Loaded Nachos', 'Corn chips, cheese, jalapenos, guac, sour cream', 6000, 6);
item(BAR_VENDORS[1].id, bb2_snacks, 'Chicken Wings (8pc)', 'Buffalo or BBQ sauce, blue cheese dip', 7000, 10);

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Event-vendor links (all vendors to active events)
// ═══════════════════════════════════════════════════════════════════════════════

// Exclude Joe's Burger Shack from event menu items (already has its own setup)
const EXCLUDE_FROM_EVENTS = new Set([V.joesBurgerShack]);

const allVendorIds = [...Object.values(V), ...BAR_VENDORS.map(v => v.id)]
  .filter(id => !EXCLUDE_FROM_EVENTS.has(id));
const activeEventIds = Object.values(EVENTS);

const eventVendors = activeEventIds.flatMap(eventId =>
  allVendorIds.map(vendorId => ({ event_id: eventId, vendor_id: vendorId }))
);

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Event menu configs (PUBLISHED for all vendor-event combos)
// ═══════════════════════════════════════════════════════════════════════════════

// Bar vendors accept orders throughout the entire event (no time restriction)
const allDayVendorIds = new Set(BAR_VENDORS.map(v => v.id));

const configs = activeEventIds.flatMap(eventId =>
  allVendorIds.map(vendorId => ({
    id: uid(),
    event_id: eventId,
    vendor_id: vendorId,
    is_accepting_orders: true,
    status: 'PUBLISHED',
    published_at: new Date().toISOString(),
    max_concurrent_orders: 50,
    max_orders_per_customer_event: 10,
    event_open_time: allDayVendorIds.has(vendorId) ? '00:00' : '08:00',
    event_close_time: allDayVendorIds.has(vendorId) ? '23:59' : '23:00',
  }))
);

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Event menu items (link every default item to every active event)
// ═══════════════════════════════════════════════════════════════════════════════

const eventMenuItems = activeEventIds.flatMap(eventId =>
  items
    .filter(mi => !EXCLUDE_FROM_EVENTS.has(mi.vendor_id))
    .map(mi => ({
      id: uid(),
      event_id: eventId,
      vendor_id: mi.vendor_id,
      default_menu_item_id: mi.id,
      is_included: true,
      display_order_override: mi.display_order,
    }))
);

// ═══════════════════════════════════════════════════════════════════════════════
// Run
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('Seeding menus...\n');

  // 1 - Bar category (check if it exists first)
  console.log('1. Category');
  const { data: existingCat } = await supabase
    .from('categories')
    .select('id')
    .eq('name', 'Bars & Cocktails')
    .maybeSingle();

  if (existingCat) {
    BAR_CAT_ID = existingCat.id;
    console.log(`  OK categories: already exists (${BAR_CAT_ID.slice(0, 8)})`);
  } else {
    await upsertRows('categories', [{ id: BAR_CAT_ID, name: 'Bars & Cocktails', description: 'Cocktail bars, craft beer, and spirits', type: 'VENDOR' }]);
  }

  // Update bar vendors with the resolved category ID
  BAR_VENDORS.forEach(v => { v.category_id = BAR_CAT_ID; });

  // 2 - Bar vendors
  console.log('2. Bar vendors');
  await upsertRows('vendors', BAR_VENDORS);

  // 2b - Vendor categories (junction table)
  console.log('2b. Vendor categories (junction table)');
  const vendorCategoryRows = BAR_VENDORS.map(v => ({
    vendor_id: v.id,
    category_id: v.category_id,
  }));
  const { error: vcError } = await supabase
    .from('vendor_categories')
    .upsert(vendorCategoryRows, { onConflict: 'vendor_id,category_id' });
  if (vcError) throw new Error(`vendor_categories: ${vcError.message}`);
  console.log(`  OK vendor_categories: ${vendorCategoryRows.length} rows`);

  // 3 - Menu categories
  console.log('3. Menu categories');
  await upsertRows('menu_categories', menuCats);

  // 4 - Default menu items
  console.log('4. Default menu items');
  await upsertRows('default_menu_items', items);

  // 5 - Event-vendor links
  console.log('5. Event-vendor links');
  const { error: evError } = await supabase.from('event_vendors').upsert(eventVendors, { onConflict: 'event_id,vendor_id' });
  if (evError) throw new Error(`event_vendors: ${evError.message}`);
  console.log(`  OK event_vendors: ${eventVendors.length} rows`);

  // 6 - Event menu configs
  console.log('6. Event menu configs');
  for (const config of configs) {
    const { data: existing } = await supabase
      .from('event_menu_configurations')
      .select('id')
      .eq('event_id', config.event_id)
      .eq('vendor_id', config.vendor_id)
      .maybeSingle();

    if (!existing) {
      const { error } = await supabase.from('event_menu_configurations').insert(config);
      if (error) console.warn(`  WARN config ${config.vendor_id.slice(0, 8)}@${config.event_id.slice(0, 8)}: ${error.message}`);
    }
  }
  console.log(`  OK event_menu_configurations: processed ${configs.length}`);

  // 7 - Event menu items
  console.log('7. Event menu items');
  for (let i = 0; i < eventMenuItems.length; i += 100) {
    const batch = eventMenuItems.slice(i, i + 100);
    const { error } = await supabase.from('event_menu_items').insert(batch);
    if (error) console.warn(`  WARN batch ${i}: ${error.message}`);
  }
  console.log(`  OK event_menu_items: ${eventMenuItems.length} rows`);

  console.log('\nDone! Seeded:');
  console.log(`   ${BAR_VENDORS.length} bar vendors`);
  console.log(`   ${menuCats.length} menu categories`);
  console.log(`   ${items.length} menu items`);
  console.log(`   across ${activeEventIds.length} events (PUBLISHED)`);
}

main().catch(err => { console.error('ERROR:', err); process.exit(1); });
