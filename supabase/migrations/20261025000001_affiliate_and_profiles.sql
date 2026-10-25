-- 002_affiliate_and_profiles.sql
-- TechPulse BD: Community User Profiles & Affiliate Marketing Engine

-- 1. User Profiles Table (Social Media Layer)
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_phone TEXT UNIQUE NOT NULL CHECK (user_phone ~ '^(\+8801|01)[3-9]\d{8}$'),
    username TEXT NOT NULL UNIQUE,
    bio TEXT DEFAULT 'PC Builder & Hardware Enthusiast',
    avatar_color TEXT DEFAULT '#10b981',
    reputation_points INT DEFAULT 15,
    upvotes_received INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_phone ON public.user_profiles(user_phone);
CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON public.user_profiles(username);

-- 2. Enhance Outbound Clicks for Affiliate Tracking
ALTER TABLE public.outbound_clicks
ADD COLUMN IF NOT EXISTS affiliate_tag TEXT DEFAULT 'techpulse_bd',
ADD COLUMN IF NOT EXISTS original_url TEXT,
ADD COLUMN IF NOT EXISTS tracking_url TEXT,
ADD COLUMN IF NOT EXISTS potential_commission NUMERIC DEFAULT 0;

-- 3. RLS Policies
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public user profiles viewable by everyone" ON public.user_profiles
    FOR SELECT USING (true);

CREATE POLICY "Anyone can upsert profile with valid phone" ON public.user_profiles
    FOR ALL USING (true) WITH CHECK (user_phone ~ '^(\+8801|01)[3-9]\d{8}$');

-- 4. Sample Seed Profiles for Active Community Feeling
INSERT INTO public.user_profiles (user_phone, username, bio, avatar_color, reputation_points, upvotes_received)
VALUES
    ('01819283746', 'Nafis_FPS', 'Competitive CS2 & Valorant player. High-refresh monitor nerd.', '#06b6d4', 120, 48),
    ('01755123456', 'Rafid_Chowdhury', 'Custom water-cooling & ITX small form factor builder.', '#10b981', 85, 32),
    ('01911998877', 'Tanvir_Overclock', 'Overclocking DDR5 RAM & Ryzen 7000/9000 undervolting.', '#f59e0b', 210, 95)
ON CONFLICT (user_phone) DO NOTHING;
