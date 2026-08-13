<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('slug')->index();
            $table->string('product_type', 20)->default('product'); // product | service
            $table->string('category')->nullable();
            $table->string('brand')->nullable();
            $table->string('unit', 32)->nullable(); // e.g. pcs, kg, hr (null for services)
            $table->text('description')->nullable();
            $table->string('image_url', 1024)->nullable();
            $table->foreignId('created_by_account_id')->nullable()->constrained('accounts')->nullOnDelete();
            $table->foreignId('created_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['product_type']);
            $table->index(['name']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('products');
    }
};
