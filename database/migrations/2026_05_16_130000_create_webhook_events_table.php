<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('webhook_events', function (Blueprint $table) {
            $table->id();
            $table->timestamp('received_at');
            $table->boolean('signature_valid')->default(false);
            $table->string('signature_secret')->nullable();
            $table->unsignedSmallInteger('http_status')->default(200);
            $table->string('object')->nullable();
            $table->string('event_type')->nullable();
            $table->string('sender_id')->nullable();
            $table->string('recipient_id')->nullable();
            $table->string('preview', 500)->nullable();
            $table->json('payload')->nullable();
            $table->string('processing_result')->nullable();
            $table->timestamps();

            $table->index('received_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('webhook_events');
    }
};
