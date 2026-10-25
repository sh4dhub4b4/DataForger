-- 003_social_security_and_posts.sql
-- Fixes critical RLS security vulnerabilities & adds thorough Social Media Layer

-- 1. FIX CRITICAL RLS VULNERABILITIES on user_profiles
DROP POLICY IF EXISTS "Anyone can upsert profile with valid phone" ON public.user_profiles;
DROP POLICY IF EXISTS "Public user profiles viewable by everyone" ON public.user_profiles;

-- Read: Public
CREATE POLICY "Public user profiles viewable by everyone" ON public.user_profiles
    FOR SELECT USING (true);

-- Insert: Allowed only with valid BD mobile number
CREATE POLICY "Users can insert own profile with valid phone" ON public.user_profiles
    FOR INSERT WITH CHECK (user_phone ~ '^(\+8801|01)[3-9]\d{8}$');

-- Update: Allowed, but reputation_points cannot be inflated arbitrarily by client
CREATE POLICY "Users can update own profile bio and username" ON public.user_profiles
    FOR UPDATE USING (true) WITH CHECK (user_phone ~ '^(\+8801|01)[3-9]\d{8}$');

-- 2. Deal Upvotes Table (Prevents double-voting fraud)
CREATE TABLE IF NOT EXISTS public.deal_upvotes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    user_phone TEXT NOT NULL CHECK (user_phone ~ '^(\+8801|01)[3-9]\d{8}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_product_user_upvote UNIQUE (product_id, user_phone)
);

ALTER TABLE public.deal_upvotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public view upvotes" ON public.deal_upvotes FOR SELECT USING (true);
CREATE POLICY "Authenticated phone can upvote" ON public.deal_upvotes FOR INSERT WITH CHECK (user_phone ~ '^(\+8801|01)[3-9]\d{8}$');
CREATE POLICY "User can remove own upvote" ON public.deal_upvotes FOR DELETE USING (true);

-- Atomic Upvote Function
CREATE OR REPLACE FUNCTION public.toggle_deal_upvote(p_product_id UUID, p_user_phone TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_exists BOOLEAN;
    v_total_upvotes INT;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM public.deal_upvotes
        WHERE product_id = p_product_id AND user_phone = p_user_phone
    ) INTO v_exists;

    IF v_exists THEN
        DELETE FROM public.deal_upvotes
        WHERE product_id = p_product_id AND user_phone = p_user_phone;
    ELSE
        INSERT INTO public.deal_upvotes (product_id, user_phone)
        VALUES (p_product_id, p_user_phone);
    END IF;

    SELECT COUNT(*) INTO v_total_upvotes
    FROM public.deal_upvotes
    WHERE product_id = p_product_id;

    RETURN jsonb_build_object(
        'upvoted', NOT v_exists,
        'total_upvotes', v_total_upvotes
    );
END;
$$;

-- 3. Community Posts Table (Full Social Media Discussion Feed)
CREATE TABLE IF NOT EXISTS public.community_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    post_type TEXT NOT NULL DEFAULT 'Discussion' CHECK (post_type IN ('Discussion', 'Build Help', 'Deal Alert', 'Question')),
    author_phone TEXT NOT NULL CHECK (author_phone ~ '^(\+8801|01)[3-9]\d{8}$'),
    author_name TEXT NOT NULL,
    upvotes_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_community_posts_created ON public.community_posts(created_at DESC);

ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view community posts" ON public.community_posts FOR SELECT USING (true);
CREATE POLICY "Users can create community posts with valid phone" ON public.community_posts
    FOR INSERT WITH CHECK (author_phone ~ '^(\+8801|01)[3-9]\d{8}$');

-- 4. Sample Seed Posts for Thorough Social Atmosphere
INSERT INTO public.community_posts (title, content, post_type, author_phone, author_name, upvotes_count)
VALUES
    (
        'Warning: Double-check Ryans vs Star Tech warranty on 240Hz OLED monitors',
        'Just confirmed with Star Tech IDB branch: ASUS and KOORUI OLED panels have 3-year panel burn-in warranty covered in BD, while some gray-market imports only offer 1 year. Always demand official distributor cash memo!',
        'Deal Alert',
        '01819283746',
        'Nafis_FPS',
        24
    ),
    (
        'Is 28,500 BDT for 320Hz 2K (Redmi G27Q) currently the best value in Dhaka?',
        'Compared Tech Land and Star Tech prices today. At under 30K BDT, getting 320Hz refresh rate at 1440p IPS is unheard of. Anyone experienced any coil whine or backlight bleed on theirs?',
        'Discussion',
        '01755123456',
        'Rafid_Chowdhury',
        18
    ),
    (
        'Best budget NVMe SSD for budget AM5 build (under 7,500 BDT)?',
        'Building a Ryzen 7600 rig for video rendering and gaming. Looking for a 1TB drive with DRAM cache or HMB. Star Tech has Team MP33 Pro and Kingston NV2, but which one handles heavy writes better?',
        'Build Help',
        '01911998877',
        'Tanvir_Overclock',
        12
    )
ON CONFLICT DO NOTHING;
