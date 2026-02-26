import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as bcrypt from 'bcryptjs';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const EMAIL = 'jenson@gmail.com';
const PASSWORD = 'Admin123#';
const NAME = 'Jenson';
const SALT_ROUNDS = 10;

async function seed() {
  // Check if already exists
  const { data: existing } = await supabase
    .from('organizer_users')
    .select('id')
    .eq('email', EMAIL)
    .single();

  if (existing) {
    console.log(`Organizer ${EMAIL} already exists — skipping.`);
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

  const { data, error } = await supabase
    .from('organizer_users')
    .insert([{ email: EMAIL, name: NAME, password_hash: passwordHash }])
    .select('id, email, name, created_at')
    .single();

  if (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  }

  console.log('Organizer seeded successfully:');
  console.log(`  id:    ${data.id}`);
  console.log(`  email: ${data.email}`);
  console.log(`  name:  ${data.name}`);
}

seed();
