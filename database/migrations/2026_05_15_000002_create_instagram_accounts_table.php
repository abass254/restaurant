<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('instagram_accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('instagram_user_id')->unique();
            $table->string('username')->nullable();
            $table->string('name')->nullable();
            $table->string('account_type')->nullable();
            $table->string('facebook_page_id')->nullable();
            $table->string('facebook_page_name')->nullable();
            $table->text('user_access_token');
            $table->text('page_access_token')->nullable();
            $table->timestamp('token_expires_at')->nullable();
            $table->json('onboarding_checks')->nullable();
            $table->boolean('onboarding_complete')->default(false);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('instagram_accounts');
    }
};
