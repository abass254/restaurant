<?php

namespace Database\Seeders;

use App\Enums\UserRole;
use App\Models\Account;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class AdminUserSeeder extends Seeder
{
    public function run(): void
    {
        $account = Account::updateOrCreate(
            ['business_name' => 'Duka AI Platform'],
            [
                'business_location' => 'Nairobi, Kenya',
                'business_category' => 'E-commerce Platform',
            ],
        );

        User::updateOrCreate(
            ['email' => 'netizen@dukai.com'],
            [
                'account_id' => $account->id,
                'name' => 'DukAI Admin',
                'phone' => '+254700000000',
                'password' => Hash::make('password'),
                'user_role' => UserRole::SystemAdmin->value,
                'is_activated' => true,
                'require_change_password' => false,
                'onboarded_at' => now(),
            ],
        );
    }
}
