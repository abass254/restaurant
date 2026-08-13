<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mpesa_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('initiated_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('phone_number', 20);
            $table->unsignedInteger('amount');
            $table->string('account_reference', 100);
            $table->string('transaction_desc', 200);
            $table->string('merchant_request_id', 100)->nullable()->index();
            $table->string('checkout_request_id', 100)->nullable()->unique();
            $table->string('status', 30)->default('pending');
            $table->integer('result_code')->nullable();
            $table->string('result_desc', 500)->nullable();
            $table->string('mpesa_receipt_number', 50)->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->json('callback_payload')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mpesa_transactions');
    }
};
