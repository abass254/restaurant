<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mpesa_configurations', function (Blueprint $table) {
            $table->id();
            $table->string('environment', 20)->default('sandbox');
            $table->string('shortcode', 20);
            $table->string('shortcode_type', 20)->default('paybill');
            $table->string('consumer_key', 255);
            $table->text('consumer_secret');
            $table->text('passkey');
            $table->string('callback_url', 500)->nullable();
            $table->string('account_reference_prefix', 50)->default('PAY');
            $table->boolean('is_active')->default(true);
            $table->timestamp('last_tested_at')->nullable();
            $table->string('last_test_result', 500)->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mpesa_configurations');
    }
};
